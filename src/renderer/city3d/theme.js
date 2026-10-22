// The project city's scene colours (#373, the proof of concept's in #382), in the run's two 3D
// themes: what the run's floor has (sky, floor, pad, lane, wall cap, shadow, lights, accent, ink,
// mast, the state colours) comes from src/renderer/run3d-theme.js (window.Run3DTheme, loaded by
// the app before this bundle), so the city and the run's floor read as one product; the rest is
// the city's own, copied from poc/project-city.html THEMES: the dim of the buildings outside a
// pinned file's connections, the lane dashes, the docks, halls, plinths and beacons, and per zone
// kind a ground, a district plate and a label ink. The buildings' colours are
// src/shared/city-layout.js colourBy (the same POC palette).
// The v2 buildings (#449, poc/project-city-v2.html THEMES and FACADES): a building tint per zone
// kind, the gardens and lawns, the night (how much the lit windows glow: full in the dark theme,
// faint in the light one), the campus and unmeasured greys, and `facade(kind)`, the zone kind's
// facade [column pitch (× WIN_PITCH), window width share, window height share, glass tint 0..1].
const CITY = {
  dark: {
    dim: '#242a37', dash: '#3a4357', dock: '#2b3247', hall: '#3d4766', plinth: '#343c52', beacon: '#7c9cff', danger: '#f87171', marker: '#facc15',
    unmeasured: '#6f788c', campus: '#3e4659', garden: '#4f9c74', lawn: '#2c4a38', pool: '#ffd9a0', night: 1.0,
    // grounds a step above the floor (#181c26), plates a step above the pad (#242a39)
    kinds: {
      civic: { ground: '#2b2d34', block: '#3b3e47', tint: '#c9b58f', ink: '#dad5c7' },
      commercial: { ground: '#2a303c', block: '#3a4253', tint: '#8db4e2', ink: '#d2dcee' },
      industrial: { ground: '#242830', block: '#343a4a', tint: '#c47a63', ink: '#dcd6d2' },
      infrastructure: { ground: '#292c35', block: '#3b404f', tint: '#a4abb8', ink: '#d4d9e3' },
      logistics: { ground: '#2d2b27', block: '#3f3c35', tint: '#cda76b', ink: '#e0d6c3' },
      power: { ground: '#20232c', block: '#303544', tint: '#8a95ab', ink: '#cbd2e1' },
      workshop: { ground: '#2c2925', block: '#3e3933', tint: '#ae8a5a', ink: '#dccfbb' },
      library: { ground: '#2e2c26', block: '#413e35', tint: '#cdbe9c', ink: '#e3dbc6' },
      campus: { ground: '#24302b', block: '#32423a', tint: '#7fb08f', ink: '#c8dccd' },
      outskirts: { ground: '#2a2b30', block: '#3b3c42', tint: '#9a958d', ink: '#cbc8c0' },
    },
  },
  light: {
    dim: '#E2E6EE', dash: '#F4F6FA', dock: '#2B3350', hall: '#5E6E8C', plinth: '#FFFFFF', beacon: '#4C6FFF', danger: '#EA4E4B', marker: '#E39A12',
    unmeasured: '#A7B0C2', campus: '#D5DAE5', garden: '#86D2AC', lawn: '#BFDCAA', pool: '#ffffff', night: 0.12,
    kinds: {
      civic: { ground: '#D3CEC2', block: '#F1EEE7', tint: '#D8C7A4', ink: '#5A5244' },
      commercial: { ground: '#D8CCB8', block: '#F3EEE5', tint: '#8DB4E2', ink: '#5E5040' },
      industrial: { ground: '#A8ADB6', block: '#DEE1E6', tint: '#C47A63', ink: '#2F3540' },
      infrastructure: { ground: '#C4C8D0', block: '#EAECF0', tint: '#A4ABB8', ink: '#3F4652' },
      logistics: { ground: '#C2BBAD', block: '#E8E4DA', tint: '#CDA76B', ink: '#4E4738' },
      power: { ground: '#979EAB', block: '#D3D7DE', tint: '#717C90', ink: '#262B35' },
      workshop: { ground: '#C9BFAF', block: '#ECE6DC', tint: '#AE8A5A', ink: '#4F4535' },
      library: { ground: '#DCD2BC', block: '#F4EFE3', tint: '#CDBE9C', ink: '#5B513A' },
      campus: { ground: '#BCD3AC', block: '#E5EFDE', tint: '#9CC594', ink: '#3E5436' },
      outskirts: { ground: '#D6D0C4', block: '#EFEBE3', tint: '#C9C2B8', ink: '#5D564A' },
    },
  },
};

// the facades per zone kind: column pitch (times WIN_PITCH), window width and height shares of a cell, glass tint (0 dark, 1 cool blue)
const FACADES = {
  civic: [1.3, 0.42, 0.64, 0.2], // tall narrow windows between pilasters
  commercial: [0.85, 0.82, 0.62, 0.9], // a glass curtain
  industrial: [1.1, 0.58, 0.42, 0.3], // small windows
  infrastructure: [1.0, 0.56, 0.5, 0.5],
  logistics: [1.4, 0.5, 0.4, 0.3],
  power: [1.2, 0.5, 0.36, 0.4],
  workshop: [1.0, 0.62, 0.5, 0.35],
  library: [1.5, 0.4, 0.72, 0.15], // tall windows, far apart
  campus: [1.0, 0.6, 0.5, 0.6],
  outskirts: [1.0, 0.58, 0.48, 0.3],
};

/** The city's palette for a theme name ('dark' for anything unknown). */
export function cityTheme(name) {
  const run = window.Run3DTheme.pick(name);
  const own = CITY[run.name] || CITY.dark;
  return {
    ...own,
    name: run.name,
    dark: run.name === 'dark',
    sky: run.sky, floor: run.floor, pad: run.pad, lane: run.lane, wallCap: run.wallCap, shadow: run.shadow, light: run.light,
    accent: run.accent, ink: run.ink, muted: run.muted, mast: run.machine.mast, status: run.status,
    kind: (kind) => own.kinds[kind] || own.kinds.outskirts,
    facade: (kind) => FACADES[kind] || FACADES.outskirts,
  };
}
