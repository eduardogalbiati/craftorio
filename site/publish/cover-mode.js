// Copies run-3d.html into site/run-3d/index.html with a cover mode (?cover): no HUD panels, only the
// floating tags, the camera following the run and no mouse controls (the page under it scrolls).
const fs = require('fs');
const path = require('path');
const [src, dest] = process.argv.slice(2);
let s = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
const once = (from, to) => {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`found ${n} times: ${from.slice(0, 80)}`);
  s = s.replace(from, () => to);
};

once("const html = htm.bind(React.createElement);",
  "const html = htm.bind(React.createElement);\n// ?cover: the landing page's cover (site/cover-poc.html): the scene and its tags only, no controls\nconst COVER = new URLSearchParams(location.search).has('cover');");
// no mouse input on the scene: the page scrolls, the camera keeps following the run
once("    c.target.copy(CENTER);\n", "    c.target.copy(CENTER);\n    if (COVER) c.enabled = false;\n");
once("    camera.position.copy(CENTER).addScaledVector(VIEW_DIR, 52);", "    camera.position.copy(CENTER).addScaledVector(VIEW_DIR, COVER ? 30 : 52);");
// the cover hides the HUD, and the tags take no clicks
once("    <${Tags} shown=${shown} onSelect=${select} />\n    <div className=\"hud\">",
  "    <${Tags} shown=${shown} onSelect=${select} />\n    ${!COVER && html`<div className=\"hud\">");
once("      <${Pipeline} shown=${shown} onSelect=${select} />\n    </div>\n  </div>`;",
  "      <${Pipeline} shown=${shown} onSelect=${select} />\n    </div>`}\n  </div>`;");
// in the cover the camera stays close to the run (a closer default zoom)
once("  useEffect(() => {\n    rig.targetFn = followRunTarget;", "  useEffect(() => {\n    if (COVER) rig.distGoal = 30;\n    rig.targetFn = followRunTarget;");
once("<title>Run 3D view (proof of concept)</title>", "<title>Run 3D view (proof of concept)</title>\n<style>body.cover .tag { pointer-events: none; } body.cover .boot { color: #7A859C; }</style>\n<script>if (new URLSearchParams(location.search).has('cover')) document.documentElement.classList.add('cover-mode');</script>");
once('<body>\n', '<body>\n<script>if (document.documentElement.classList.contains(\'cover-mode\')) document.body.classList.add(\'cover\');</script>\n');

// the first frame drawn: the tags show and the page that holds the cover is told (it fades the scene
// in over its poster image); ?shot keeps the drawing buffer, so the poster can be taken from the canvas
once("function Scene({ shown, onSelect }) {\n  useFrame((_, dt) => sim.tick(dt));",
  "let firstFrame = true;\nfunction Scene({ shown, onSelect }) {\n  useFrame((_, dt) => {\n    sim.tick(dt);\n    if (firstFrame) {\n      firstFrame = false;\n      requestAnimationFrame(() => {\n        document.body.classList.add('ready');\n        if (COVER && window.parent !== window) window.parent.postMessage({ type: 'run3d-ready' }, '*');\n      });\n    }\n  });");
once("<${Canvas} shadows flat dpr=${[1, 2]} camera=${{ fov: 30, near: 1, far: 400 }}",
  "<${Canvas} shadows flat dpr=${[1, 2]} gl=${{ preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') }} camera=${{ fov: 30, near: 1, far: 400 }}");
once("body.cover .tag { pointer-events: none; }", "body.cover .tag { pointer-events: none; } body:not(.ready) .tags { visibility: hidden; }");
// the cover is dark, in the landing page's colours: DK(light, dark) picks the floor's, the walls',
// the lights' and the background's colour; robots, desks and tags keep theirs
once("const COVER = new URLSearchParams(location.search).has('cover');",
  "const COVER = new URLSearchParams(location.search).has('cover');\nconst DK = (light, dark) => (COVER ? dark : light);");
const dark = [
  ['<${B} p=${[0, 0.04, 0.45]} s=${[4.1, 0.08, 4.5]} c="#FFFFFF" r=${0.04} />', "<${B} p=${[0, 0.04, 0.45]} s=${[4.1, 0.08, 4.5]} c=${DK('#FFFFFF', '#1A1F33')} r=${0.04} />"],
  ['<${B} p=${[0, 0.05, -0.5]} s=${[3.2, 0.1, 5.2]} c="#DDE3EF" r=${0.04} />', "<${B} p=${[0, 0.05, -0.5]} s=${[3.2, 0.1, 5.2]} c=${DK('#DDE3EF', '#232A45')} r=${0.04} />"],
  ['<cylinderGeometry args=${[1.45, 1.6, 0.26, 40]} /><meshStandardMaterial color="#FFFFFF"', "<cylinderGeometry args=${[1.45, 1.6, 0.26, 40]} /><meshStandardMaterial color=${DK('#FFFFFF', '#262C48')}"],
  ['<meshStandardMaterial color="#DDE3F0" roughness=${0.9} />', "<meshStandardMaterial color=${DK('#DDE3F0', '#283052')} roughness=${0.9} />"],
  ['<circleGeometry args=${[160, 48]} /><meshBasicMaterial color="#E8EDF7"', "<circleGeometry args=${[160, 48]} /><meshBasicMaterial color=${DK('#E8EDF7', '#07070D')}"],
  ['<shadowMaterial opacity=${0.13} color="#3A4A7A" />', "<shadowMaterial opacity=${DK(0.13, 0.5)} color=${DK('#3A4A7A', '#000000')} />"],
  ['s=${[27, 0.4, 23.4]} c="#EDF0F8"', "s=${[27, 0.4, 23.4]} c=${DK('#EDF0F8', '#121627')}"],
  ['s=${[27, 2.5, 0.4]} c="#DCE3F1"', "s=${[27, 2.5, 0.4]} c=${DK('#DCE3F1', '#1B2036')}"],
  ['s=${[0.4, 2.5, 23.2]} c="#DCE3F1"', "s=${[0.4, 2.5, 23.2]} c=${DK('#DCE3F1', '#1B2036')}"],
  ['s=${[27.2, 0.14, 0.6]} c="#FFFFFF"', "s=${[27.2, 0.14, 0.6]} c=${DK('#FFFFFF', '#2B3354')}"],
  ['s=${[0.6, 0.14, 23.4]} c="#FFFFFF"', "s=${[0.6, 0.14, 23.4]} c=${DK('#FFFFFF', '#2B3354')}"],
  ["const win = '#C7D8FF';", "const win = DK('#C7D8FF', '#4A66C8');"],
  ['s=${[9.4, 1.9, 0.08]} c="#FFFFFF"', "s=${[9.4, 1.9, 0.08]} c=${DK('#FFFFFF', '#161B2E')}"],
  ["{ text: RUN.workflow, size: 64, y: 70, color: '#4C6FFF' }", "{ text: RUN.workflow, size: 64, y: 70, color: DK('#4C6FFF', '#93A6FF') }"],
  ['<${B} p=${[-0.2, 0.04, 0]} s=${[2.4, 0.08, 2.4]} c="#FFFFFF"', "<${B} p=${[-0.2, 0.04, 0]} s=${[2.4, 0.08, 2.4]} c=${DK('#FFFFFF', '#1A1F33')}"],
  ['s=${[0.9, 0.8, 1.5]} c="#C9D2E4"', "s=${[0.9, 0.8, 1.5]} c=${DK('#C9D2E4', '#3A4366')}"],
  ['s=${[2.6, 0.08, 3.2]} c="#FFFFFF"', "s=${[2.6, 0.08, 3.2]} c=${DK('#FFFFFF', '#1A1F33')}"],
  ["<color attach=\"background\" args=${['#E8EDF7']} />", "<color attach=\"background\" args=${[DK('#E8EDF7', '#07070D')]} />"],
  ["<hemisphereLight args=${['#FFFFFF', '#CBD5EC', 1.95]} />", "<hemisphereLight args=${[DK('#FFFFFF', '#DCE4FF'), DK('#CBD5EC', '#1B2140'), DK(1.95, 1.45)]} />"],
  ['<directionalLight position=${[-12, 24, 15]} intensity=${1.45}', '<directionalLight position=${[-12, 24, 15]} intensity=${DK(1.45, 1.85)}'],
];
for (const [from, to] of dark) once(from, to);
// the page behind the canvas (the loading screen) is dark too
once("body.cover .tag { pointer-events: none; }", "body.cover { --bg: #07070D; --muted: #8A93B0; } body.cover .tag { pointer-events: none; }");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, s);
console.log('ok');
