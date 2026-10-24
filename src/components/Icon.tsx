const paths = {
  overview: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  plan: 'M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 9 3 3 5-5',
  records: 'M7 3h10l3 3v15H4V3h3Zm1 6h8m-8 4h8m-8 4h5',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 5 7 7-7 7',
  search: 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'
}
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
