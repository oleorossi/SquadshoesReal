// Light-tone re-export of icons + a few extras for paper docs
const PIcon = {
  Logo: ({ size = 36 }) => (
    <svg width={size} height={size} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="34" height="34" fill="white" stroke="#14110E" strokeWidth="1.5"/>
      <path d="M9 24 L9 16 L 14 16 L 17 12 L 26 12 L 26 21 L 21 24 Z" fill="none" stroke="#14110E" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="12" cy="25" r="1.6" fill="#14110E"/>
      <circle cx="23" cy="25" r="1.6" fill="#14110E"/>
      <rect x="29" y="3" width="6" height="6" fill="#B7141F"/>
    </svg>
  ),
  QR: ({ size = 64 }) => {
    // simple QR-style placeholder (deterministic noise grid)
    const cells = [];
    for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) {
      const fin = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7);
      const finOn = fin && ((r === 0 || r === 6 || r === 14 || r === 20 || c === 0 || c === 6 || c === 14 || c === 20) || (r >= 2 && r <= 4 && c >= 2 && c <= 4) || (r >= 2 && r <= 4 && c >= 16 && c <= 18) || (r >= 16 && r <= 18 && c >= 2 && c <= 4));
      const random = ((r * 13 + c * 7 + r * c) % 5) < 2;
      if (fin ? finOn : random) cells.push(<rect key={r+'-'+c} x={c * (size/21)} y={r * (size/21)} width={size/21+0.4} height={size/21+0.4} fill="#14110E"/>);
    }
    return <svg width={size} height={size}>{cells}</svg>;
  },
};
window.PIcon = PIcon;
