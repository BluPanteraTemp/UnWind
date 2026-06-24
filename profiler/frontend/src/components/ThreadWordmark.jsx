const variants = {
  home: {
    outer: "relative mx-auto w-full max-w-[420px]",
    frame: "relative w-full px-4 pb-7 pt-2",
    textWrap: "relative text-center",
    text: "text-6xl font-light tracking-normal sm:text-7xl",
    svg: "absolute -bottom-4 -left-8 h-16 w-[calc(120%+0rem)] overflow-visible px-8",
    scale: "",
  },

  header: {
    outer: "relative h-[58px] w-[90px] overflow-visible",
    frame: "relative w-[420px] origin-top-left scale-[0.31] px-4 pb-7 pt-2",
    textWrap: "relative text-center",
    text: "text-7xl font-light tracking-normal",
    svg: "absolute -bottom-4 -left-8 h-16 w-[calc(120%+0rem)] overflow-visible px-8",
    scale: "",
  },
};

export default function ThreadWordmark({ variant = "home" }) {
  const styles = variants[variant] ?? variants.home;
  const gradientId = `unwind-thread-${variant}`;
  const WordmarkTag = variant === "home" ? "h1" : "div";

  return (
    <div className={styles.outer} aria-label="UnWind">
      <div className={styles.frame}>
        <div className={styles.textWrap}>
          <WordmarkTag className={`${styles.text} text-slate-900`}>
            <span className="bg-gradient-to-r from-blue-700 via-cyan-600 to-teal-500 bg-clip-text text-transparent">
              Data Profiler
            </span>
          </WordmarkTag>
        </div>

        <svg
          viewBox="-20 0 460 54"
          aria-hidden="true"
          className={styles.svg}
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="8"
              y1="24"
              x2="412"
              y2="28"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#1d4ed8" />
              <stop offset="42%" stopColor="#2563eb" />
              <stop offset="68%" stopColor="#0891b2" />
              <stop offset="100%" stopColor="#14b8a6" />
            </linearGradient>
          </defs>

          <path
            className="unwind-thread-draw"
            d="M12 29c20 4 46 1 50-8 3-7-10-10-16-4-10 10 8 18 44 17 42-1 72-9 126-6 48 3 85 10 138 5 22-2 40-3 64-2"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="4.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}