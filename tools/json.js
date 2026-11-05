// Write JSON readably: short arrays and small objects stay on one line,
// so maps and tilesets are easy to edit as text.
export function pretty(stat, indent = '', width = 160) {
  const short = JSON.stringify(stat);
  if (short === undefined) return 'null';
  if (typeof stat !== 'object' || stat === null) return short;
  const inner = indent + ' ';
  const flat = Array.isArray(stat) ? !stat.some(x => typeof x === 'string' && x.length > 20) : true;
  if (short.length + indent.length <= width && flat && !Array.isArray(stat) ? Object.values(stat).every(x => typeof x !== 'object' || x === null || Array.isArray(x) || Object.values(x).every(y => typeof y !== 'object' || y === null)) : short.length + indent.length <= width && flat) return short.replace(/,"/g, ', "').replace(/":/g, '": ').replace(/,(?=[\d\[-])/g, ', ');
  if (Array.isArray(stat)) return '[\n' + stat.map(x => inner + pretty(x, inner, width)).join(',\n') + '\n' + indent + ']';
  return '{\n' + Object.entries(stat).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner, width)}`).join(',\n') + '\n' + indent + '}';
}
