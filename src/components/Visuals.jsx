import { Wifi, WifiOff } from "lucide-react";

export function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-symbol" aria-hidden="true">
        <span>同</span>
        <i />
      </span>
      <span className="brand-copy">
        <strong>同词相见</strong>
        {!compact && <small>WORD TO MEET YOU</small>}
      </span>
    </div>
  );
}

export function ConnectionBadge({ status }) {
  const isOnline = status === "online";
  const isConnecting = status === "connecting";
  const Icon = isOnline ? Wifi : WifiOff;
  const label = isOnline
    ? "联机正常"
    : isConnecting
      ? "正在接通"
      : status === "unstable"
        ? "连接波动"
        : "等待联机";

  return (
    <div className={`connection-badge is-${status}`} title={label}>
      <Icon size={14} strokeWidth={2.2} />
      <span>{label}</span>
    </div>
  );
}

const floatingWords = [
  { text: "海", x: 72, y: 150, tone: "teal" },
  { text: "晚风", x: 456, y: 122, tone: "coral" },
  { text: "山", x: 86, y: 428, tone: "ink" },
  { text: "灯", x: 472, y: 436, tone: "lime" },
  { text: "月亮", x: 288, y: 78, tone: "ink" },
  { text: "远方", x: 250, y: 508, tone: "teal" },
];

export function WordConstellation() {
  return (
    <div className="constellation" aria-label="两个词逐渐靠近的插画">
      <div className="constellation-grid" />
      <svg viewBox="0 0 620 620" role="img" aria-hidden="true">
        <path
          className="constellation-path path-a"
          d="M115 260 C210 160 390 160 506 260"
        />
        <path
          className="constellation-path path-b"
          d="M120 352 C230 470 390 470 500 352"
        />
        <path
          className="constellation-path path-c"
          d="M255 305 C300 286 336 286 378 305"
        />
        {floatingWords.map((word, index) => (
          <g
            className={`floating-word tone-${word.tone}`}
            key={word.text}
            style={{ animationDelay: `${index * 0.55}s` }}
            transform={`translate(${word.x} ${word.y})`}
          >
            <rect width="82" height="38" rx="19" />
            <circle cx="20" cy="19" r="2.5" />
            <text x="34" y="25">
              {word.text}
            </text>
          </g>
        ))}
        <g className="meet-node meet-you" transform="translate(74 265)">
          <rect width="156" height="72" rx="26" />
          <text x="30" y="28" className="node-label">
            你
          </text>
          <text x="30" y="54" className="node-word">
            月亮
          </text>
        </g>
        <g className="meet-node meet-them" transform="translate(390 265)">
          <rect width="156" height="72" rx="26" />
          <text x="30" y="28" className="node-label">
            TA
          </text>
          <text x="30" y="54" className="node-word">
            月亮
          </text>
        </g>
        <g className="same-word" transform="translate(286 300)">
          <circle cx="24" cy="0" r="24" />
          <path d="M16 0h16M24-8v16" />
        </g>
      </svg>
      <div className="constellation-caption">
        <span>各自写下</span>
        <i />
        <span>彼此联想</span>
        <i />
        <span>同词相见</span>
      </div>
    </div>
  );
}

export function TimerRing({ seconds, totalSeconds, active = true }) {
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, seconds / Math.max(totalSeconds, 1)));
  return (
    <div className={`timer-ring ${!active ? "is-paused" : ""}`} aria-label={`剩余 ${seconds} 秒`}>
      <svg viewBox="0 0 68 68" aria-hidden="true">
        <circle className="timer-track" cx="34" cy="34" r={radius} />
        <circle
          className="timer-value"
          cx="34"
          cy="34"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <strong>{Math.max(0, seconds)}</strong>
      <small>秒</small>
    </div>
  );
}
