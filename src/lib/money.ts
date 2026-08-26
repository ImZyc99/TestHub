/**
 * 金额显示（单位元）。
 * 一元以上留两位；零头要留到看得出差别为止 —— 早先固定四位小数，
 * 遇到 0.000012 这种会被抹成「¥0」，看着像免费，实际不是。
 */
export function money(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1) return v.toFixed(2)

  const trim = (s: string) => s.replace(/0+$/, '').replace(/\.$/, '')
  // 从四位小数开始加精度，直到这个数不再被舍成 0
  for (let digits = 4; digits <= 10; digits++) {
    const s = trim(v.toFixed(digits))
    if (Number(s) !== 0) return s
  }
  return v.toExponential(1)
}
