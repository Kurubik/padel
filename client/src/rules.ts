import type { Key } from "./i18n.ts";

const W = 320;
const H = 200;

function svg(inner: string): string {
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

const courtOutline = `
  <rect x="70" y="18" width="180" height="164" rx="4" fill="#153461" stroke="#cfe0ff" stroke-opacity="0.5" stroke-width="2"/>
  <line x1="70" y1="100" x2="250" y2="100" stroke="#d9ff2f" stroke-opacity="0.85" stroke-width="3"/>
  <line x1="70" y1="72" x2="250" y2="72" stroke="#cfe0ff" stroke-opacity="0.55" stroke-width="2"/>
  <line x1="70" y1="128" x2="250" y2="128" stroke="#cfe0ff" stroke-opacity="0.55" stroke-width="2"/>
  <line x1="160" y1="72" x2="160" y2="128" stroke="#cfe0ff" stroke-opacity="0.55" stroke-width="2"/>`;

function dot(x: number, y: number, color: string): string {
  return `<circle cx="${x}" cy="${y}" r="9" fill="${color}"/><circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#070b14" stroke-width="2"/>`;
}

export const LESSON_ART: Record<string, string> = {
  "rules.1": svg(`${courtOutline}${dot(118, 148, "#ff5b4d")}${dot(202, 148, "#ff5b4d")}${dot(118, 52, "#5aa0ff")}${dot(202, 52, "#5aa0ff")}
    <text x="160" y="192" fill="#93a3c8" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">10 m x 20 m</text>`),
  "rules.2": svg(`${courtOutline}
    <rect x="70" y="100" width="90" height="28" fill="#d9ff2f" fill-opacity="0.18"/>
    <path d="M206 158 C 150 150, 128 132, 112 116" fill="none" stroke="#d9ff2f" stroke-width="3" stroke-dasharray="7 6" stroke-linecap="round"/>
    ${dot(206, 158, "#ff5b4d")}
    <text x="160" y="192" fill="#93a3c8" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">diagonal box</text>`),
  "rules.3": svg(`${courtOutline}
    <circle cx="96" cy="60" r="6" fill="#d9ff2f"/>
    <circle cx="120" cy="86" r="6" fill="#d9ff2f" fill-opacity="0.75"/>
    <circle cx="150" cy="132" r="6" fill="#d9ff2f"/>
    <path d="M96 60 L126 96 L156 134" fill="none" stroke="#d9ff2f" stroke-width="2.5" stroke-dasharray="6 5"/>
    <text x="176" y="96" fill="#93a3c8" font-size="12" font-family="Inter, sans-serif">1 bounce</text>
    <text x="176" y="140" fill="#93a3c8" font-size="12" font-family="Inter, sans-serif">then glass</text>`),
  "rules.4": svg(`${courtOutline}
    <rect x="70" y="18" width="180" height="30" fill="#a9c8ff" fill-opacity="0.18"/>
    <rect x="70" y="18" width="180" height="10" fill="#8fa8d8" fill-opacity="0.4"/>
    <path d="M210 74 L120 74" stroke="#d9ff2f" stroke-width="3" stroke-linecap="round"/>
    <text x="160" y="192" fill="#93a3c8" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">fence ends a serve</text>`),
  "rules.5": svg(`<rect x="60" y="52" width="200" height="96" rx="12" fill="#101a30" stroke="#cfe0ff" stroke-opacity="0.3"/>
    <text x="160" y="96" fill="#eef3ff" font-size="34" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">40 - 30</text>
    <text x="160" y="126" fill="#93a3c8" font-size="14" text-anchor="middle" font-family="Inter, sans-serif">15 · 30 · 40 · game</text>
    <text x="160" y="176" fill="#d9ff2f" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">deuce &amp; advantage</text>`),
  "rules.6": svg(`${courtOutline}
    <circle cx="120" cy="70" r="6" fill="#ff5b4d"/><circle cx="120" cy="88" r="6" fill="#ff5b4d"/>
    <circle cx="196" cy="60" r="6" fill="#ff5b4d"/>
    <path d="M196 60 L236 40" stroke="#ff5b4d" stroke-width="2.5" stroke-dasharray="5 4"/>
    <text x="160" y="192" fill="#93a3c8" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">two bounces · wall first</text>`),
  "rules.7": svg(`${courtOutline}${dot(118, 122, "#ff5b4d")}${dot(196, 122, "#ff5b4d")}
    <path d="M100 140 L100 108" stroke="#d9ff2f" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arw)"/>
    <path d="M214 140 L214 108" stroke="#d9ff2f" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arw)"/>
    <path d="M96 152 L214 152" stroke="#d9ff2f" stroke-width="2.5" stroke-dasharray="7 5"/>
    <defs><marker id="arw" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#d9ff2f"/></marker></defs>
    <text x="160" y="186" fill="#93a3c8" font-size="12" text-anchor="middle" font-family="Inter, sans-serif">shift and cover as a pair</text>`),
};

export const LESSON_KEYS: Array<{ title: Key; body: Key; art: string }> = [
  { title: "rules.1.title", body: "rules.1.body", art: "rules.1" },
  { title: "rules.2.title", body: "rules.2.body", art: "rules.2" },
  { title: "rules.3.title", body: "rules.3.body", art: "rules.3" },
  { title: "rules.4.title", body: "rules.4.body", art: "rules.4" },
  { title: "rules.5.title", body: "rules.5.body", art: "rules.5" },
  { title: "rules.6.title", body: "rules.6.body", art: "rules.6" },
  { title: "rules.7.title", body: "rules.7.body", art: "rules.7" },
];
