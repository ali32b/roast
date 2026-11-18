import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Clock,
  Group,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector4,
  WebGLRenderer,
} from "three";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => MathUtils.smoothstep(x, a, b);

/* ------------------------------------------------------------------
   The film: one photographic plate per chapter.
   Each plate is graded in-shader so six different photographs read as
   one continuous, dark, warm piece.
   ------------------------------------------------------------------ */

const BASE = import.meta.env.BASE_URL;

const PLATES = [
  { src: BASE + "img/hero.jpg", bright: 1.0, pan: [0, 0] },
  { src: BASE + "img/bean.jpg", bright: 1.45, pan: [0.85, -0.9] },
  { src: BASE + "img/brew.jpg", bright: 0.45, pan: [-1.0, 0.2] },
  { src: BASE + "img/cup.jpg", bright: 1.15, pan: [0.1, -0.15] },
  { src: BASE + "img/menu.jpg", bright: 0.72, pan: [0.9, 0.15] },
  { src: BASE + "img/visit.jpg", bright: 1.25, pan: [0.2, 0.1] },
];

const plateVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const plateFrag = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uMapA;
  uniform sampler2D uMapB;
  uniform vec4 uUvA;
  uniform vec4 uUvB;
  uniform float uMix;
  uniform float uBrightA;
  uniform float uBrightB;

  uniform float uGlobal;
  uniform float uSat;
  uniform float uContrast;
  uniform float uWarm;
  uniform float uVignette;
  uniform float uAspect;
  uniform vec2 uParallax;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 grade(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = (c - 0.5) * uContrast + 0.5;
    c = max(c, 0.0);
    c = c * 0.93 + vec3(0.016, 0.013, 0.010);
    c *= vec3(1.0 + 0.055 * uWarm, 0.995, 1.0 - 0.062 * uWarm);
    return c;
  }

  void main() {
    vec2 uvA = (vUv - 0.5) * uUvA.xy + 0.5 + uUvA.zw;
    vec2 uvB = (vUv - 0.5) * uUvB.xy + 0.5 + uUvB.zw;

    // Luminance doubles as a depth cue: brighter areas read as closer, so
    // they slide a hair more than the dark ground. Cheap 2.5D on a still.
    vec3 sA = texture2D(uMapA, uvA).rgb;
    vec3 sB = texture2D(uMapB, uvB).rgb;
    vec2 dA = uParallax * smoothstep(0.04, 0.7, luma(sA));
    vec2 dB = uParallax * smoothstep(0.04, 0.7, luma(sB));
    sA = texture2D(uMapA, clamp(uvA + dA, 0.001, 0.999)).rgb;
    sB = texture2D(uMapB, clamp(uvB + dB, 0.001, 0.999)).rgb;

    vec3 ca = grade(sA * uBrightA);
    vec3 cb = grade(sB * uBrightB);

    vec3 c = mix(ca, cb, uMix);

    // film dissolve: the frame dips dark at the join, so two photographs
    // never sit on top of each other in full view
    c *= 1.0 - 0.6 * sin(3.14159265 * uMix);

    // a slow warm bloom in the lower third, like a light source off frame
    float bloom = smoothstep(0.85, 0.05, vUv.y) * 0.05;
    c += vec3(0.30, 0.17, 0.08) * bloom;

    // vignette
    vec2 d = (vUv - 0.5) * vec2(uAspect * 0.62, 1.0);
    float vig = 1.0 - uVignette * smoothstep(0.15, 0.78, length(d));
    c *= vig;

    gl_FragColor = vec4(c * uGlobal, 1.0);
  }
`;

/* ------------------------------------------------------------------
   Bokeh / dust — the only true depth in the frame
   ------------------------------------------------------------------ */

function softSprite(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255,235,205,0.95)");
  g.addColorStop(0.28, "rgba(255,205,150,0.45)");
  g.addColorStop(0.62, "rgba(230,160,100,0.12)");
  g.addColorStop(1, "rgba(200,120,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createExperience(canvas) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch (err) {
    return { update() {}, setPointer() {}, resize() {}, destroy() {} };
  }

  renderer.setClearAlpha(0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 6);
  scene.add(camera);

  const loader = new TextureLoader();
  const textures = new Array(PLATES.length).fill(null);
  let loadedCount = 0;

  const uniforms = {
    uMapA: { value: null },
    uMapB: { value: null },
    uUvA: { value: new Vector4(1, 1, 0, 0) },
    uUvB: { value: new Vector4(1, 1, 0, 0) },
    uMix: { value: 0 },
    uBrightA: { value: 1 },
    uBrightB: { value: 1 },
    uGlobal: { value: 0 },
    uSat: { value: 0.78 },
    uContrast: { value: 1.14 },
    uWarm: { value: 1 },
    uVignette: { value: 0.55 },
    uAspect: { value: 1 },
    uParallax: { value: new Vector2(0, 0) },
  };

  const plateMat = new ShaderMaterial({
    vertexShader: plateVert,
    fragmentShader: plateFrag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  const plate = new Mesh(new PlaneGeometry(1, 1), plateMat);
  plate.position.z = -12;
  plate.renderOrder = -10;
  plate.frustumCulled = false;
  camera.add(plate);

  // a soft black frame so the plate always blends into the page
  const lace = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthTest: false })
  );

  /* bokeh -------------------------------------------------------- */
  const BOKEH = 64;
  const bokehGeo = new BufferGeometry();
  const bokehPos = new Float32Array(BOKEH * 3);
  const bokehSeed = new Float32Array(BOKEH);
  for (let i = 0; i < BOKEH; i++) {
    bokehPos[i * 3] = (Math.random() - 0.5) * 12;
    bokehPos[i * 3 + 1] = (Math.random() - 0.5) * 8;
    bokehPos[i * 3 + 2] = -5.6 + Math.random() * 9;
    bokehSeed[i] = Math.random() * 100;
  }
  bokehGeo.setAttribute("position", new BufferAttribute(bokehPos, 3));

  const bokeh = new Points(
    bokehGeo,
    new PointsMaterial({
      size: 0.55,
      map: softSprite(),
      color: 0xffc48a,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  bokeh.renderOrder = 1;
  scene.add(bokeh);

  // a handful of larger, softer orbs — foreground bokeh
  const front = new Group();
  for (let i = 0; i < 7; i++) {
    const m = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: softSprite(),
        color: 0xffb26b,
        transparent: true,
        opacity: 0.16,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    );
    const s = 1.6 + Math.random() * 2.6;
    m.scale.set(s, s, 1);
    m.position.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 7, 2.4 + Math.random() * 2.4);
    front.add(m);
  }
  scene.add(front);

  /* state -------------------------------------------------------- */
  let width = 1;
  let height = 1;
  let intro = reduce ? 1 : 0;
  const pointerSmooth = new Vector2();
  const pointerTarget = new Vector2();
  const clock = new Clock();
  let lastA = -1;
  let lastB = -1;

  function uvRect(tex, zoom, panX, panY) {
    const img = tex.image;
    const ta = img.width / img.height;
    const va = width / height;
    let sx = 1;
    let sy = 1;
    if (va > ta) sy = ta / va;
    else sx = va / ta;

    sx /= zoom;
    sy /= zoom;

    const maxX = (1 - sx) * 0.5;
    const maxY = (1 - sy) * 0.5;
    return [sx, sy, clamp(panX, -1, 1) * maxX, clamp(panY, -1, 1) * maxY];
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    width = Math.max(1, w);
    height = Math.max(1, h);

    const dpr = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // fit the plate to the frustum at its own depth (+ 8% overscan, enough
    // for the pointer drift without stealing the photograph's framing)
    const dist = 12;
    const fovRad = (camera.fov * Math.PI) / 180;
    const planeH = 2 * Math.tan(fovRad / 2) * dist * 1.08;
    const planeW = planeH * camera.aspect;
    plate.scale.set(planeW, planeH, 1);

    uniforms.uAspect.value = camera.aspect;
  }

  function setPointer(x, y) {
    pointerTarget.set(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  /* load --------------------------------------------------------- */
  PLATES.forEach((p, i) => {
    loader.load(
      p.src,
      (tex) => {
        tex.colorSpace = NoColorSpace;
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.generateMipmaps = false;
        tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        textures[i] = tex;
        loadedCount++;
        if (i === 0) {
          uniforms.uMapA.value = tex;
          uniforms.uBrightA.value = p.bright;
          lastA = 0;
        }
        if (i === 1) {
          uniforms.uMapB.value = tex;
          uniforms.uBrightB.value = p.bright;
          lastB = 1;
        }
      },
      undefined,
      () => {}
    );
  });

  /* loop --------------------------------------------------------- */
  function update(progress) {
    const dt = Math.min(clock.getDelta(), 0.06);
    const t = clock.elapsedTime;

    intro += (1 - intro) * Math.min(1, dt * 1.4);
    if (reduce) intro = 1;
    uniforms.uGlobal.value = intro;

    const p = reduce ? 0 : clamp(progress, 0, 1);
    const n = PLATES.length;
    const x = p * (n - 1);
    const i = clamp(Math.floor(x), 0, n - 2);
    const f = clamp(x - i, 0, 1);

    const nextA = i;
    const nextB = i + 1;

    if (nextA !== lastA && textures[nextA]) {
      uniforms.uMapA.value = textures[nextA];
      uniforms.uBrightA.value = PLATES[nextA].bright;
      lastA = nextA;
    }
    if (nextB !== lastB && textures[nextB]) {
      uniforms.uMapB.value = textures[nextB];
      uniforms.uBrightB.value = PLATES[nextB].bright;
      lastB = nextB;
    }

    uniforms.uMix.value = sstep(0.36, 0.72, f);

    pointerSmooth.lerp(pointerTarget, Math.min(1, dt * 3.2));
    const px = pointerSmooth.x;
    const py = pointerSmooth.y;

    uniforms.uParallax.value.set(
      px * 0.016 + (p - 0.5) * 0.005,
      py * 0.014
    );

    // one continuous push across the whole film — a jump at a cut would read
    const push = 1.06 + p * 0.08;

    if (textures[lastA]) {
      const pl = PLATES[lastA];
      uniforms.uUvA.value.fromArray(
        uvRect(textures[lastA], push + f * 0.1, pl.pan[0] - px * 0.8, pl.pan[1] - py * 0.6)
      );
    }
    if (textures[lastB]) {
      const pl = PLATES[lastB];
      uniforms.uUvB.value.fromArray(
        uvRect(textures[lastB], push + f * 0.03, pl.pan[0] - px * 0.65, pl.pan[1] - py * 0.5)
      );
    }

    // camera drifts — the bokeh moves, the plate stays glued to the frame
    camera.position.x = px * 0.34 + Math.sin(t * 0.13) * 0.06;
    camera.position.y = py * 0.22 + Math.cos(t * 0.11) * 0.05;
    camera.rotation.y = -px * 0.05;
    camera.rotation.x = py * 0.038;

    // bokeh drift + scroll parallax
    const pos = bokehGeo.attributes.position;
    for (let k = 0; k < BOKEH; k++) {
      const s = bokehSeed[k];
      const y0 = pos.getY(k);
      pos.setY(k, y0 + Math.sin(t * 0.12 + s) * 0.0006);
      pos.setX(k, pos.getX(k) + Math.cos(t * 0.09 + s) * 0.0004);
    }
    pos.needsUpdate = true;
    bokeh.position.y = -p * 1.1 + Math.sin(t * 0.16) * 0.12;
    bokeh.material.opacity = 0.3 + 0.1 * Math.sin(t * 0.5);

    front.children.forEach((m, k) => {
      m.position.y += Math.sin(t * 0.18 + k) * 0.0009;
      m.material.opacity = 0.1 + 0.05 * Math.sin(t * 0.4 + k * 1.7);
    });
    front.position.y = -p * 1.8;

    renderer.render(scene, camera);
  }

  resize();

  if (import.meta.env.DEV) window.__scene = { uniforms, renderer, scene };

  return {
    update,
    setPointer,
    resize,
    destroy() {
      textures.forEach((tx) => tx && tx.dispose());
      plateMat.dispose();
      renderer.dispose();
    },
  };
}
