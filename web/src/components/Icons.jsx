/** Architectural SVG icon set — zero emoji, stroke-based, 24px grid */
const I = (path, size = 20, extra = {}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...extra}
  >
    {path}
  </svg>
);

export const IconGrid = ({ size, className }) =>
  I(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
    size,
    { className }
  );

export const IconAgent = ({ size, className }) =>
  I(
    <>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9 16.5h6" />
    </>,
    size,
    { className }
  );

export const IconPlus = ({ size, className }) =>
  I(
    <>
      <path d="M12 5v14M5 12h14" />
    </>,
    size,
    { className }
  );

export const IconPulse = ({ size, className }) =>
  I(
    <path d="M3 12h4l2-6 4 12 2-6h6" />,
    size,
    { className }
  );

export const IconShield = ({ size, className }) =>
  I(
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </>,
    size,
    { className }
  );

export const IconBolt = ({ size, className }) =>
  I(<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />, size, { className });

export const IconFingerprint = ({ size, className }) =>
  I(
    <>
      <path d="M12 11a2 2 0 0 0-2 2c0 2.5.5 4.5 1 6" />
      <path d="M12 11a2 2 0 0 1 2 2c0 3-.5 5-1 7" />
      <path d="M8.5 8A4.5 4.5 0 0 1 12 6.5" />
      <path d="M15.5 8A4.5 4.5 0 0 0 12 6.5" />
      <path d="M6 13c0-3.3 2.7-6 6-6" />
      <path d="M18 13c0-2-.6-3.8-1.6-5.3" />
      <path d="M4.5 16A8.5 8.5 0 0 1 12 3" />
    </>,
    size,
    { className }
  );

export const IconWallet = ({ size, className }) =>
  I(
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </>,
    size,
    { className }
  );

export const IconPause = ({ size, className }) =>
  I(
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>,
    size,
    { className }
  );

export const IconPlay = ({ size, className }) =>
  I(<path d="M7 4.5l12 7.5-12 7.5v-15z" />, size, { className });

export const IconArrowLeft = ({ size, className }) =>
  I(
    <>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </>,
    size,
    { className }
  );

export const IconArrowRight = ({ size, className }) =>
  I(
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>,
    size,
    { className }
  );

export const IconExternal = ({ size, className }) =>
  I(
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4L10 14" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>,
    size,
    { className }
  );

export const IconCheck = ({ size, className }) =>
  I(<path d="M5 12l5 5L19 7" />, size, { className });

export const IconX = ({ size, className }) =>
  I(
    <>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </>,
    size,
    { className }
  );

export const IconAlert = ({ size, className }) =>
  I(
    <>
      <path d="M12 3L2.5 19.5h19L12 3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
    </>,
    size,
    { className }
  );

export const IconRefresh = ({ size, className }) =>
  I(
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>,
    size,
    { className }
  );

export const IconLock = ({ size, className }) =>
  I(
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
    size,
    { className }
  );

export const IconLayers = ({ size, className }) =>
  I(
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </>,
    size,
    { className }
  );

export const IconTerminal = ({ size, className }) =>
  I(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </>,
    size,
    { className }
  );

export const IconLink = ({ size, className }) =>
  I(
    <>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
    </>,
    size,
    { className }
  );

export const IconGithub = ({ size, className }) =>
  I(
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-1-2.6c3.1-.4 6.4-1.6 6.4-7.2A5.4 5.4 0 0 0 20 4.8a5 5 0 0 0-.1-3.7s-1.2-.3-3.9 1.5a13.4 13.4 0 0 0-7 0C6.3 1.1 5.1 1.4 5.1 1.4A5 5 0 0 0 5 5.1a5.4 5.4 0 0 0-1.4 3.7c0 5.6 3.3 6.8 6.4 7.2a3.4 3.4 0 0 0-1 2.6V22" />,
    size,
    { className }
  );

export const IconDoc = ({ size, className }) =>
  I(
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>,
    size,
    { className }
  );

export const IconSquare = ({ size = 18, className }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
    <rect width="100" height="100" rx="22" fill="#0B13FA" />
  </svg>
);

export const IconLogoMark = ({ size = 32, className }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
    <rect width="100" height="100" rx="22" fill="#0B13FA" />
    <path
      d="M30 62V38l20 12 20-12v24"
      fill="none"
      stroke="#fff"
      strokeWidth="8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconChevronDown = ({ size, className }) =>
  I(<path d="M6 9l6 6 6-6" />, size, { className });
