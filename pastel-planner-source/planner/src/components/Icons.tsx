import type { SVGProps } from 'react';
import type { CategoryIcon } from '../domain/types';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});

const mk = (paths: JSX.Element) => ({ size, ...rest }: P) => <svg {...base(size)} {...rest}>{paths}</svg>;

export const ICalendar = mk(<><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>);
export const IGantt = mk(<><path d="M4 4v16h16" /><rect x="7" y="6" width="7" height="3" rx="1.2" /><rect x="10" y="11" width="8" height="3" rx="1.2" /><rect x="8" y="16" width="5" height="2.5" rx="1.2" /></>);
export const IFolder = mk(<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />);
export const IList = mk(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></>);
export const IHome = mk(<><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5" rx="2" /><rect x="13.5" y="11" width="7.5" height="10" rx="2" /><rect x="3" y="15" width="7.5" height="6" rx="2" /></>);
export const ISettings = mk(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IPlus = mk(<path d="M12 5v14M5 12h14" />);
export const IChevL = mk(<path d="M15 18l-6-6 6-6" />);
export const IChevR = mk(<path d="M9 18l6-6-6-6" />);
export const IChevD = mk(<path d="M6 9l6 6 6-6" />);
export const ISearch = mk(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IX = mk(<path d="M18 6L6 18M6 6l12 12" />);
export const ICheck = mk(<path d="M20 6L9 17l-5-5" />);
export const ITrash = mk(<><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>);
export const ICopy = mk(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>);
export const IEdit = mk(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" /></>);
export const IMenu = mk(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IWarn = mk(<><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>);
export const IInfo = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>);
export const IDownload = mk(<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>);
export const IUpload = mk(<><path d="M12 21V9M7 14l5-5 5 5" /><path d="M5 3h14" /></>);
export const IClock = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IBlock = mk(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>);
export const IPlay = mk(<path d="M7 5l11 7-11 7z" />);
export const IAlert = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></>);
export const IDiamond = mk(<path d="M12 3l9 9-9 9-9-9z" />);
export const ILink = mk(<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>);
export const IFlag = mk(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>);
export const IBriefcase = mk(<><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></>);
export const IHeart = mk(<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />);
export const ILeaf = mk(<><path d="M11 20A7 7 0 0 1 4 13c0-6 6-9 16-9 0 10-3 16-9 16z" /><path d="M4 20c4-4 7-6 11-8" /></>);
export const IUsers = mk(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>);
export const IBell = mk(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>);
export const IDot = mk(<circle cx="12" cy="12" r="4" fill="currentColor" />);
export const IStar = mk(<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />);
export const IBaseline = mk(<><path d="M3 9h12" /><path d="M6 15h14" strokeDasharray="2 2.5" /></>);

const CAT_ICONS: Record<CategoryIcon, (p: P) => JSX.Element> = {
  briefcase: IBriefcase, heart: IHeart, leaf: ILeaf, users: IUsers, bell: IBell, dot: IDot, star: IStar, flag: IFlag,
};
export function CatIcon({ icon, size = 12, ...rest }: P & { icon: CategoryIcon }) {
  const C = CAT_ICONS[icon] ?? IDot;
  return <C size={size} {...rest} />;
}
export const CATEGORY_ICON_OPTIONS = Object.keys(CAT_ICONS) as CategoryIcon[];
