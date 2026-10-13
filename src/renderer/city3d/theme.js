// The project city's scene colours (#373), in the run's two 3D themes: what the run's floor has
// (sky, floor, pad, lane, wall cap, shadow, lights, accent, ink, mast) comes from
// src/renderer/run3d-theme.js (window.Run3DTheme, loaded by the app before this bundle), so the
// city and the run's floor read as one product; the rest is the city's own, from the proof of
// concept (poc/project-city.html): the docks, plinths and beacons, and per zone kind a ground, a
// district plate and a label ink. The buildings' colours are src/shared/city-layout.js colourBy.
const CITY = {
  dark: {
    dim: '#242a37', dash: '#3a4357', dock: '#2b3247', hall: '#3d4766', plinth: '#343c52', beacon: '#7c9cff', danger: '#f87171', marker: '#facc15',
    // grounds a step above the floor (#181c26), plates a step above the pad (#242a39)
    kinds: {
      civic: { ground: '#2b2d34', block: '#3b3e47', ink: '#dad5c7' },
      commercial: { ground: '#2a303c', block: '#3a4253', ink: '#d2dcee' },
      industrial: { ground: '#242830', block: '#343a4a', ink: '#dcd6d2' },
      infrastructure: { ground: '#292c35', block: '#3b404f', ink: '#d4d9e3' },
      logistics: { ground: '#2d2b27', block: '#3f3c35', ink: '#e0d6c3' },
      power: { ground: '#20232c', block: '#303544', ink: '#cbd2e1' },
      workshop: { ground: '#2c2925', block: '#3e3933', ink: '#dccfbb' },
      library: { ground: '#2e2c26', block: '#413e35', ink: '#e3dbc6' },
      campus: { ground: '#24302b', block: '#32423a', ink: '#c8dccd' },
      outskirts: { ground: '#2a2b30', block: '#3b3c42', ink: '#cbc8c0' },
    },
  },
  light: {
    dim: '#E2E6EE', dash: '#F4F6FA', dock: '#2B3350', hall: '#5E6E8C', plinth: '#FFFFFF', beacon: '#4C6FFF', danger: '#EA4E4B', marker: '#E39A12',
    kinds: {
      civic: { ground: '#D3CEC2', block: '#F1EEE7', ink: '#5A5244' },
      commercial: { ground: '#D8CCB8', block: '#F3EEE5', ink: '#5E5040' },
      industrial: { ground: '#A8ADB6', block: '#DEE1E6', ink: '#2F3540' },
      infrastructure: { ground: '#C4C8D0', block: '#EAECF0', ink: '#3F4652' },
      logistics: { ground: '#C2BBAD', block: '#E8E4DA', ink: '#4E4738' },
      power: { ground: '#979EAB', block: '#D3D7DE', ink: '#262B35' },
      workshop: { ground: '#C9BFAF', block: '#ECE6DC', ink: '#4F4535' },
      library: { ground: '#DCD2BC', block: '#F4EFE3', ink: '#5B513A' },
      campus: { ground: '#BCD3AC', block: '#E5EFDE', ink: '#3E5436' },
      outskirts: { ground: '#D6D0C4', block: '#EFEBE3', ink: '#5D564A' },
    },
  },
};

/** The city's palette for a theme name ('dark' for anything unknown). */
export function cityTheme(name) {
  const run = window.Run3DTheme.pick(name);
  const own = CITY[run.name] || CITY.dark;
  return {
    ...own,
    name: run.name,
    sky: run.sky, floor: run.floor, pad: run.pad, lane: run.lane, wallCap: run.wallCap, shadow: run.shadow, light: run.light,
    accent: run.accent, ink: run.ink, muted: run.muted, mast: run.machine.mast,
    kind: (kind) => own.kinds[kind] || own.kinds.outskirts,
  };
}
