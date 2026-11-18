import "./styles.css";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createExperience } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------
   Renderer
   --------------------------------------------------------------- */
const canvas = document.getElementById("scene");
const experience = createExperience(canvas);

let bar = document.querySelector(".progress i");
let progressTarget = 0;
let progressNow = 0;

/* ---------------------------------------------------------------
   Smooth scroll
   --------------------------------------------------------------- */
const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 84;

let lenis = null;
if (!reduce) {
  lenis = new Lenis({
    lerp: 0.09,
    wheelMultiplier: 0.95,
    touchMultiplier: 1.4,
    smoothWheel: true,
  });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

function scrollToTarget(target) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset: -navH + 1, duration: 1.5 });
  else el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------
   Chapter anchors → 0..1 progress
   --------------------------------------------------------------- */
const sections = Array.from(document.querySelectorAll("[data-scene]"));
let anchors = [];
let tops = [];

function measure() {
  const vh = window.innerHeight;
  tops = sections.map((s) => s.offsetTop);
  anchors = sections.map((s) => ({
    top: s.offsetTop + Math.max(0, s.offsetHeight - vh) * 0.5,
  }));
  if (anchors.length > 1 && anchors[0].top < vh * 0.5) anchors[0].top = vh * 0.5;
}

function progressFromScroll(y) {
  const n = anchors.length;
  if (!n) return 0;
  if (y <= anchors[0].top) return 0;
  if (y >= anchors[n - 1].top) return 1;
  let i = 0;
  while (i < n - 2 && y >= anchors[i + 1].top) i++;
  const a = anchors[i].top;
  const b = anchors[i + 1].top;
  const t = (y - a) / Math.max(1, b - a);
  return (i + t) / (n - 1);
}

measure();

const nav = document.getElementById("nav");
const navLinks = Array.from(document.querySelectorAll(".nav__links a"));
let activeIndex = -1;

function setActive(i) {
  if (i === activeIndex) return;
  activeIndex = i;
  const id = sections[i] ? sections[i].id : "";
  navLinks.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`));
}

ScrollTrigger.create({
  trigger: document.documentElement,
  start: "top top",
  end: "bottom bottom",
  onUpdate: (self) => {
    const y = self.scroll();
    progressTarget = progressFromScroll(y);
    if (bar) bar.style.transform = `scaleX(${progressTarget.toFixed(4)})`;
    nav.classList.toggle("is-pinned", y > 32);

    let idx = 0;
    const line = y + window.innerHeight * 0.45;
    for (let i = 0; i < tops.length; i++) if (line >= tops[i] - 1) idx = i;
    setActive(idx);
  },
});

/* ---------------------------------------------------------------
   Render loop
   --------------------------------------------------------------- */
const pointer = { x: 0, y: 0 };
let pointerDirty = false;

window.addEventListener(
  "pointermove",
  (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    pointerDirty = true;
  },
  { passive: true }
);

gsap.ticker.add(() => {
  progressNow += (progressTarget - progressNow) * 0.16;
  if (Math.abs(progressTarget - progressNow) < 0.00005) progressNow = progressTarget;

  if (pointerDirty) {
    experience.setPointer(pointer.x, pointer.y);
    pointerDirty = false;
  }
  experience.update(progressNow);
});

window.addEventListener("resize", () => {
  experience.resize();
  measure();
  ScrollTrigger.refresh();
});

/* ---------------------------------------------------------------
   Hero entrance
   --------------------------------------------------------------- */
if (!reduce) {
  const heroLines = document.querySelectorAll(".hero__title .line > span");
  gsap.set(heroLines, { yPercent: 108 });
  gsap.set("[data-hero='1'], [data-hero='5'], [data-hero='6'], [data-hero='7'], [data-hero='8']", {
    opacity: 0,
    y: 18,
  });

  const tl = gsap.timeline({ delay: 0.2, defaults: { ease: "expo.out" } });
  tl.to(heroLines, { yPercent: 0, duration: 1.4, stagger: 0.085 }, 0)
    .to("[data-hero='1']", { opacity: 1, y: 0, duration: 1.1 }, 0.1)
    .to("[data-hero='5']", { opacity: 1, y: 0, duration: 1.1 }, 0.6)
    .to("[data-hero='6']", { opacity: 1, y: 0, duration: 1.1 }, 0.72)
    .to("[data-hero='7']", { opacity: 1, y: 0, duration: 1.1 }, 0.85)
    .to("[data-hero='8']", { opacity: 1, y: 0, duration: 1 }, 1.05);

  // the cue dissolves as soon as you move
  gsap.to(".hero__cue", {
    opacity: 0,
    ease: "none",
    scrollTrigger: { trigger: "#hero", start: "top top", end: "35% top", scrub: true },
  });
}

/* ---------------------------------------------------------------
   Section reveals
   --------------------------------------------------------------- */
const reveals = gsap.utils.toArray("[data-reveal]");
const lineBlocks = gsap.utils.toArray("[data-lines]");

if (!reduce) {
  gsap.set(reveals, { opacity: 0, y: 26 });

  ScrollTrigger.batch(reveals, {
    start: "top 90%",
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: 1.05,
        ease: "power3.out",
        stagger: 0.08,
        overwrite: true,
      }),
  });

  lineBlocks.forEach((block) => {
    const lines = block.querySelectorAll(".line > span");
    gsap.set(lines, { yPercent: 106 });
    gsap.to(lines, {
      yPercent: 0,
      duration: 1.15,
      ease: "expo.out",
      stagger: 0.07,
      scrollTrigger: { trigger: block, start: "top 88%", once: true },
    });
  });
}

/* ---------------------------------------------------------------
   Depth: the type and the photograph move at different rates
   --------------------------------------------------------------- */
if (!reduce) {
  sections.forEach((sec) => {
    const inner = sec.querySelector(".wrap");
    if (!inner) return;
    gsap.fromTo(
      inner,
      { yPercent: 5.5, z: -90, rotateX: 3.5, transformOrigin: "50% 100%" },
      {
        yPercent: -5.5,
        z: 0,
        rotateX: -3,
        ease: "none",
        scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: 0.6 },
      }
    );
  });
}

/* ---------------------------------------------------------------
   Nav
   --------------------------------------------------------------- */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (!id || id === "#") return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    closeMenu();
    scrollToTarget(target);
  });
});

const burger = document.querySelector(".nav__menu");
const mobile = document.getElementById("mobile-menu");

function closeMenu() {
  if (!mobile || mobile.hidden) return;
  mobile.classList.remove("is-open");
  burger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("is-locked");
  if (lenis) lenis.start();
  window.setTimeout(() => {
    if (!mobile.classList.contains("is-open")) mobile.hidden = true;
  }, 320);
}

function openMenu() {
  mobile.hidden = false;
  requestAnimationFrame(() => mobile.classList.add("is-open"));
  burger.setAttribute("aria-expanded", "true");
  document.body.classList.add("is-locked");
  if (lenis) lenis.stop();
}

burger?.addEventListener("click", () => {
  if (mobile.classList.contains("is-open")) closeMenu();
  else openMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

/* ---------------------------------------------------------------
   Booking form
   --------------------------------------------------------------- */
const form = document.getElementById("book");
const note = document.getElementById("book-note");
const dateInput = document.getElementById("date");

if (dateInput) {
  const fmt = new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long" });
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const opt = document.createElement("option");
    opt.value = iso;
    opt.textContent = i === 0 ? `امروز — ${fmt.format(d)}` : i === 1 ? `فردا — ${fmt.format(d)}` : fmt.format(d);
    dateInput.appendChild(opt);
  }
}

form?.addEventListener("submit", (e) => {
  e.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = new FormData(form);
  const date = String(data.get("date") || "");
  const time = String(data.get("time") || "");
  const guests = String(data.get("guests") || "");

  const subject = "درخواست رزرو میز — رُست";
  const body = [
    "سلام،",
    "",
    "برای رزرو میز درخواست دارم:",
    `تاریخ: ${date}`,
    `ساعت: ${time}`,
    `تعداد نفرات: ${guests}`,
    "",
    "با سپاس",
  ].join("\n");

  window.location.href = `mailto:reserve@roast.cafe?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (note) {
    note.textContent = "ایمیل رزرو باز شد. پس از ارسال، تا یک روز کاری تأیید می‌شود.";
  }
});

/* ---------------------------------------------------------------
   Refresh after fonts land
   --------------------------------------------------------------- */
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    measure();
    ScrollTrigger.refresh();
  });
}

window.addEventListener("load", () => {
  measure();
  ScrollTrigger.refresh();
});

/* dev-only inspection hook */
if (import.meta.env.DEV) {
  window.__roast = {
    lenis,
    ScrollTrigger,
    progressFromScroll,
    anchors: () => anchors,
    sections,
  };
}
