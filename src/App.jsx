import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock,
  Copy,
  DoorOpen,
  LoaderCircle,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  DURATION_OPTIONS,
  ROOM_CODE_LENGTH,
  createRoom,
  createRoomCode,
  sanitizeCode,
  sanitizeWord,
  toPublicRoom,
} from "./game.js";
import { RoomClient } from "./roomClient.js";
import {
  getPlayerId,
  getSavedName,
  loadGuestSession,
  loadHostRoom,
  removeGuestSession,
  removeHostRoom,
  saveGuestSession,
  saveHostRoom,
  saveName,
} from "./storage.js";
import {
  Brand,
  ConnectionBadge,
  TimerRing,
  WordConstellation,
} from "./components/Visuals.jsx";

function getRoomUrl(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

function cleanName(value) {
  return String(value ?? "").trim();
}

function ImeInput({
  value,
  onValueChange,
  sanitize = (input) => input,
  onCompositionChange,
  className = "",
  ...props
}) {
  const inputRef = useRef(null);
  const composingRef = useRef(false);
  const sanitizeRef = useRef(sanitize);
  const [composing, setComposing] = useState(false);
  sanitizeRef.current = sanitize;

  useEffect(() => {
    if (!composingRef.current && inputRef.current && inputRef.current.value !== value) {
      inputRef.current.value = value ?? "";
    }
  }, [value]);

  function changeComposition(next) {
    if (composingRef.current === next) return;
    composingRef.current = next;
    setComposing(next);
    onCompositionChange?.(next);
  }

  function commit(rawValue) {
    const nextValue = sanitizeRef.current(rawValue);
    if (inputRef.current && inputRef.current.value !== nextValue) {
      inputRef.current.value = nextValue;
    }
    onValueChange(nextValue);
  }

  function handleChange(event) {
    if (composingRef.current || event.nativeEvent.isComposing) {
      changeComposition(true);
      return;
    }
    onValueChange(sanitizeRef.current(event.currentTarget.value));
  }

  function handleCompositionEnd(event) {
    commit(event.currentTarget.value);
    changeComposition(false);
  }

  function handleBlur(event) {
    if (composingRef.current) {
      commit(event.currentTarget.value);
      changeComposition(false);
    }
  }

  return (
    <input
      {...props}
      ref={inputRef}
      defaultValue={value ?? ""}
      className={`${className} ${composing ? "is-composing" : ""}`.trim()}
      onChange={handleChange}
      onCompositionStart={() => changeComposition(true)}
      onCompositionEnd={handleCompositionEnd}
      onBlur={handleBlur}
    />
  );
}

function useCountdown({ phase, round, durationSec, roundRemainingMs, revealRemainingMs, updatedAt }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (phase === "playing") {
      const deadline = Date.now() + Math.max(0, roundRemainingMs || 0);
      const update = () => {
        setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      };
      update();
      const timer = window.setInterval(update, 200);
      return () => window.clearInterval(timer);
    }

    if (phase === "reveal") {
      const deadline = Date.now() + Math.max(0, revealRemainingMs || 0);
      const update = () => {
        setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      };
      update();
      const timer = window.setInterval(update, 200);
      return () => window.clearInterval(timer);
    }

    setRemaining(0);
    return undefined;
  }, [
    phase,
    round,
    durationSec,
    roundRemainingMs,
    revealRemainingMs,
    updatedAt,
  ]);

  return remaining;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.tone || "info"}`} role="status" aria-live="polite">
      <span>{toast.text}</span>
      <button type="button" onClick={onClose} title="关闭提示" aria-label="关闭提示">
        <X size={15} />
      </button>
    </div>
  );
}

function AppHeader({
  mode,
  connection,
  roomCode,
  onLeave,
  onBack,
}) {
  return (
    <header className="app-header">
      <Brand compact={mode !== "home"} />
      <div className="header-actions">
        {mode === "room" && (
          <>
            <span className="header-room-code">房间 {roomCode}</span>
            <ConnectionBadge status={connection} />
            <button
              className="icon-button"
              type="button"
              onClick={onLeave}
              title="离开房间"
              aria-label="离开房间"
            >
              <DoorOpen size={18} />
            </button>
          </>
        )}
        {mode === "join" && (
          <button className="text-button" type="button" onClick={onBack}>
            <ArrowLeft size={16} />
            返回首页
          </button>
        )}
        {mode === "home" && <span className="header-note">双人 · 免登录 · 实时联机</span>}
      </div>
    </header>
  );
}

function HomeScreen({
  name,
  onNameChange,
  duration,
  onDurationChange,
  code,
  onCodeChange,
  error,
  busy,
  onCreate,
  onJoinRequest,
}) {
  return (
    <main className="home-screen">
      <section className="home-copy">
        <div className="eyebrow">
          <span>默契实验</span>
          <i />
          <span>第 01 局</span>
        </div>
        <h1>
          同词
          <span>相见</span>
        </h1>
        <p className="home-intro">
          先各自写下一个词。看见彼此后，再顺着那两个词继续想。
          <br />
          也许下一轮，你们就会说出同一个词。
        </p>

        <div className="flow-line" aria-label="游戏流程">
          <span>
            <b>01</b>起词
          </span>
          <i />
          <span>
            <b>02</b>联想
          </span>
          <i />
          <span>
            <b>03</b>同词
          </span>
        </div>

        <form className="entry-panel" onSubmit={onCreate}>
          <div className="entry-title">
            <div>
              <span>开一间房</span>
              <small>把链接发给朋友就能一起玩</small>
            </div>
            <Sparkles size={23} />
          </div>

          <label className="field">
            <span>你的昵称</span>
            <ImeInput
              type="text"
              value={name}
              onValueChange={onNameChange}
              placeholder="朋友怎么称呼你"
              autoComplete="nickname"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              enterKeyHint="next"
            />
          </label>

          <fieldset className="duration-field">
            <legend>每轮时间</legend>
            <div className="segmented">
              {DURATION_OPTIONS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  className={duration === seconds ? "is-active" : ""}
                  aria-pressed={duration === seconds}
                  onClick={() => onDurationChange(seconds)}
                >
                  {seconds} 秒
                </button>
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="form-error">
              <CircleAlert size={15} />
              {error}
            </p>
          )}

          <button className="primary-button create-button" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : <Plus size={19} />}
            创建房间
            <ArrowRight size={18} />
          </button>

          <div className="join-divider">
            <span>或者，用朋友给你的房号加入</span>
          </div>

          <div className="quick-join">
            <input
              type="text"
              value={code}
              onChange={(event) => onCodeChange(sanitizeCode(event.target.value))}
              placeholder="6 位房号"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck="false"
              aria-label="房间号"
            />
            <button type="button" onClick={onJoinRequest}>
              加入
              <ArrowRight size={17} />
            </button>
          </div>
        </form>
      </section>

      <section className="home-visual">
        <WordConstellation />
        <div className="visual-note">
          <span>不接龙，也不限提示词</span>
          <strong>只要你们想到一起</strong>
        </div>
      </section>
    </main>
  );
}

function JoinScreen({
  code,
  onCodeChange,
  name,
  onNameChange,
  error,
  joining,
  onJoin,
  onBack,
}) {
  return (
    <main className="join-screen">
      <section className="join-poster">
        <div className="join-poster-mark">
          <span>你</span>
          <i />
          <span>TA</span>
        </div>
        <p>有人留了一个词的位置给你</p>
        <h1>朋友邀你<br />同词相见</h1>
        <div className="join-code-display">
          <small>房间号</small>
          <strong>{code || "······"}</strong>
        </div>
      </section>

      <form className="join-form" onSubmit={onJoin}>
        <div className="section-number">02 / JOIN</div>
        <h2>推门进来</h2>
        <p>留一个昵称，朋友会知道是你。</p>

        <label className="field">
          <span>房间号</span>
          <input
            className="code-field"
            type="text"
            value={code}
            onChange={(event) => onCodeChange(sanitizeCode(event.target.value))}
            maxLength={ROOM_CODE_LENGTH}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
          />
        </label>

        <label className="field">
          <span>你的昵称</span>
          <ImeInput
            type="text"
            value={name}
            onValueChange={onNameChange}
            placeholder="轻轻写下名字"
            autoComplete="nickname"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            enterKeyHint="next"
            autoFocus
          />
        </label>

        {error && (
          <p className="form-error">
            <CircleAlert size={15} />
            {error}
          </p>
        )}

        <button className="primary-button" type="submit" disabled={joining}>
          {joining ? <LoaderCircle className="spin" size={19} /> : <ArrowRight size={19} />}
          {joining ? "正在敲门" : "加入房间"}
        </button>
        <button className="join-back-button" type="button" onClick={onBack}>
          我自己开一间
        </button>
      </form>
    </main>
  );
}

function PlayerSeat({ player, isYou, index, emptyText = "等待朋友" }) {
  if (!player) {
    return (
      <div className="player-seat is-empty">
        <span className="player-avatar">
          <Users size={22} />
        </span>
        <span className="player-copy">
          <strong>{emptyText}</strong>
          <small>邀请链接还能拉一个人进来</small>
        </span>
      </div>
    );
  }

  return (
    <div className={`player-seat seat-${index}`}>
      <span className="player-avatar">{Array.from(player.name)[0] || "?"}</span>
      <span className="player-copy">
        <strong>{player.name}</strong>
        <small>{isYou ? "你" : player.role === "host" ? "房主" : "朋友"}</small>
      </span>
      <span className={`presence-dot ${player.online ? "is-online" : ""}`} title={player.online ? "在线" : "离线"} />
    </div>
  );
}

function WaitingStage({
  room,
  session,
  onInvite,
  onStart,
  onCopy,
  connection,
}) {
  const isHost = session.role === "host";
  const host = room.players.find((player) => player.role === "host");
  const guest = room.players.find((player) => player.role === "guest");
  const canStart = isHost && room.players.length === 2;

  return (
    <main className="waiting-stage">
      <div className="waiting-copy">
        <div className="section-number">01 / WAITING ROOM</div>
        <h1>
          房间开好了，
          <br />
          等朋友来坐。
        </h1>
        <p>
          {isHost
            ? "把房间链接发过去。两个人到齐后，由你按下开始。"
            : host
              ? "你已经在房间里，等房主按下开始。"
              : "正在等房主开门，房间接通后会自动进来。"}
        </p>
      </div>

      <section className="invite-board">
        <div className="invite-topline">
          <span>房间号</span>
          <ConnectionBadge status={connection} />
        </div>
        <div className="room-code-large">{room.code}</div>
        <div className="invite-buttons">
          <button type="button" className="primary-button" onClick={onInvite}>
            <QrCode size={18} />
            邀请朋友
          </button>
          <button type="button" className="secondary-button" onClick={onCopy}>
            复制链接
            <Copy size={17} />
          </button>
        </div>
      </section>

      <section className="seats-panel">
        <div className="seats-heading">
          <span>这间房里的人</span>
          <small>{room.players.length} / 2</small>
        </div>
        <div className="seat-list">
          <PlayerSeat player={host} isYou={host?.id === session.player.id} index={0} />
          <div className="seat-connector">
            <i />
            <span>VS</span>
            <i />
          </div>
          <PlayerSeat player={guest} isYou={guest?.id === session.player.id} index={1} />
        </div>
        <div className="start-row">
          {isHost ? (
            <button
              className="primary-button start-button"
              type="button"
              onClick={onStart}
              disabled={!canStart}
            >
              <Play size={18} fill="currentColor" />
              {canStart ? "开始这一局" : "等朋友进来后开始"}
            </button>
          ) : (
            <div className="waiting-host">
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {host ? "等房主开始" : "正在敲房间的门"}
            </div>
          )}
          <p>
            <Clock size={15} />
            每轮 {room.durationSec} 秒，可自由提前提交
          </p>
        </div>
      </section>
    </main>
  );
}

function WordChip({ player, meId, word, muted = false, matched = false }) {
  const isYou = player?.id === meId;
  return (
    <div className={`word-chip ${isYou ? "is-you" : "is-them"} ${muted ? "is-muted" : ""} ${matched ? "is-match" : ""}`}>
      <span>{isYou ? "你" : player?.name || "TA"}</span>
      <strong>{word || "未作答"}</strong>
    </div>
  );
}

function PreviousWords({ record, meId }) {
  if (!record) return null;
  return (
    <div className="previous-words">
      <span className="context-label">上一轮</span>
      {record.words.map((entry) => {
        const player = { id: entry.id, name: entry.name };
        return (
          <WordChip
            key={entry.id}
            player={player}
            meId={meId}
            word={entry.word}
            matched={record.match}
          />
        );
      })}
    </div>
  );
}

function HistoryPanel({ history, meId }) {
  return (
    <aside className="history-panel">
      <div className="history-heading">
        <div>
          <span>沿途的词</span>
          <small>每一轮都算数</small>
        </div>
        <b>{String(history.length).padStart(2, "0")}</b>
      </div>
      {history.length === 0 ? (
        <div className="history-empty">
          <span>这里还是空的</span>
          <p>第一轮揭晓后，你们的词会留在这里。</p>
        </div>
      ) : (
        <ol className="history-list">
          {history
            .slice()
            .reverse()
            .map((record) => (
              <li key={record.round} className={record.match ? "is-match" : ""}>
                <div className="history-round">
                  <span>第 {record.round} 轮</span>
                  {record.match && <Check size={13} />}
                </div>
                <div className="history-words">
                  {record.words.map((entry) => (
                    <span key={entry.id} className={entry.id === meId ? "is-you" : ""}>
                      {entry.word || "未答"}
                    </span>
                  ))}
                </div>
              </li>
            ))}
        </ol>
      )}
    </aside>
  );
}

function RevealStage({
  room,
  myPlayer,
  opponent,
  seconds,
  onPlayAgain,
  isHost,
}) {
  const record = room.history[room.history.length - 1];
  const matched = room.phase === "won";

  return (
    <div className={`reveal-stage ${matched ? "is-match" : ""}`}>
      <div className="reveal-kicker">
        {matched ? (
          <>
            <Sparkles size={17} />
            第 {record.round} 轮 · 同词相见
          </>
        ) : (
          <>第 {record.round} 轮 · 同时揭晓</>
        )}
      </div>

      <div className="reveal-words">
        {record.words.map((entry, index) => (
          <div className="reveal-word-wrap" key={entry.id}>
            <WordChip
              player={{ id: entry.id, name: entry.name }}
              meId={myPlayer.id}
              word={entry.word}
              matched={matched}
            />
            {index === 0 && (
              <span className={`match-symbol ${matched ? "is-match" : ""}`}>
                {matched ? "=" : "≠"}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="reveal-copy">
        <h1>{matched ? `“${room.winnerWord}”` : "这一轮，擦肩而过"}</h1>
        <p>
          {matched
            ? `你们在第 ${record.round} 轮想到了一起。`
            : "词已经亮出来了。再看看彼此的方向，下一轮继续靠近。"}
        </p>
      </div>

      {matched ? (
        <div className="reveal-actions">
          {isHost ? (
            <button className="primary-button" type="button" onClick={onPlayAgain}>
              <RotateCcw size={18} />
              再来一局
            </button>
          ) : (
            <span className="guest-waiting">
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              等房主发起下一局
            </span>
          )}
        </div>
      ) : (
        <div className="next-round-countdown">
          <span className="typing-dots">
            <i />
            <i />
            <i />
          </span>
          <span>{seconds > 0 ? `${seconds} 秒后继续联想` : "正在进入下一轮"}</span>
        </div>
      )}

      <div className="reveal-player-note">
        <span>{myPlayer.name}，你这一轮写了「{record.words.find((item) => item.id === myPlayer.id)?.word || "空白"}」</span>
        {opponent && <span>{opponent.name} 写了「{record.words.find((item) => item.id === opponent.id)?.word || "空白"}」</span>}
      </div>
    </div>
  );
}

function WritingStage({
  room,
  myPlayer,
  opponent,
  seconds,
  onSubmit,
}) {
  const [word, setWord] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [composing, setComposing] = useState(false);
  const previous = room.history[room.history.length - 1];
  const timeUp = seconds <= 0;
  const submitted = myPlayer.submitted;

  useEffect(() => {
    setWord("");
    setSubmitting(false);
    setComposing(false);
  }, [room.round, room.phase]);

  function handleSubmit(event) {
    event.preventDefault();
    const cleaned = sanitizeWord(word);
    if (!cleaned || submitted || timeUp || composing) return;
    setSubmitting(true);
    const accepted = onSubmit(cleaned);
    if (!accepted) setSubmitting(false);
  }

  return (
    <div className="writing-stage">
      <div className="round-topline">
        <div>
          <span className="round-label">ROUND {String(room.round).padStart(2, "0")}</span>
          <strong>第 {room.round} 轮</strong>
        </div>
        <TimerRing
          seconds={seconds}
          totalSeconds={room.durationSec}
          active={!submitted && !timeUp}
        />
      </div>

      {room.round > 1 && previous ? (
        <>
          <PreviousWords record={previous} meId={myPlayer.id} />
          <h1>
            看见彼此以后，
            <br />
            再写一个更近的词。
          </h1>
          <p className="writing-prompt">
            不用解释联想过程。你们要做的，是在下一次揭晓时想到同一个词。
          </p>
        </>
      ) : (
        <>
          <div className="first-word-mark">
            <span>起点</span>
            <i />
            <span>凭直觉</span>
          </div>
          <h1>
            先各自写一个词，
            <br />
            不用和对方商量。
          </h1>
          <p className="writing-prompt">
            写下此刻第一个浮现在脑海里的词。揭晓以后，再开始向彼此靠近。
          </p>
        </>
      )}

      <form className="word-form" onSubmit={handleSubmit}>
        <label htmlFor="word-input">这一轮，你想写</label>
        <div
          className={`word-input-row ${submitted ? "is-submitted" : ""} ${composing ? "is-composing" : ""}`}
        >
          <ImeInput
            id="word-input"
            type="text"
            value={word}
            onValueChange={setWord}
            onCompositionChange={setComposing}
            sanitize={sanitizeWord}
            placeholder={timeUp ? "本轮时间到了" : submitted ? "已经写好了" : "一个词就好"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            enterKeyHint="send"
            disabled={submitted || timeUp}
            autoFocus
          />
          {composing && (
            <span className="composing-label" aria-live="polite">
              正在选词…
            </span>
          )}
          <button
            type="submit"
            disabled={!word.trim() || submitted || timeUp || submitting || composing}
            title="提交这个词"
          >
            {submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
            {submitted ? "已提交" : "提交"}
          </button>
        </div>
        <div className="word-form-meta">
          <span>字数不限</span>
          <span>{timeUp ? "等待揭晓" : "在倒计时结束前，随时可以提交"}</span>
        </div>
      </form>

      <div className="writing-status">
        <div className={myPlayer.submitted ? "is-ready" : ""}>
          <span>{Array.from(myPlayer.name)[0]}</span>
          <b>{myPlayer.name}</b>
          <small>{myPlayer.submitted ? "已经写好了" : "正在想"}</small>
        </div>
        <i />
        <div className={opponent?.submitted ? "is-ready" : ""}>
          <span>{opponent ? Array.from(opponent.name)[0] : "?"}</span>
          <b>{opponent?.name || "等待朋友"}</b>
          <small>
            {opponent?.online === false
              ? "暂时离线"
              : opponent?.submitted
                ? "已经写好了"
                : "正在想"}
          </small>
        </div>
      </div>
    </div>
  );
}

function JoiningStage({ code, onCancel }) {
  return (
    <main className="joining-stage">
      <div className="joining-mark">
        <span>你</span>
        <i />
        <span>TA</span>
      </div>
      <div className="section-number">正在接通房间 {code}</div>
      <h1>敲一敲门，看看朋友在不在。</h1>
      <p>房间接通后会自动进入，不用刷新页面。</p>
      <span className="large-loader">
        <LoaderCircle className="spin" size={25} />
      </span>
      <button className="join-back-button" type="button" onClick={onCancel}>
        取消加入
      </button>
    </main>
  );
}

function RoomScreen({
  room,
  session,
  connection,
  onStart,
  onSubmit,
  onInvite,
  onCopy,
  onPlayAgain,
  onCancelJoin,
}) {
  const isHost = session.role === "host";
  const meId = session.player.id;
  const myPlayer = room?.players.find((player) => player.id === meId);
  const opponent = room?.players.find((player) => player.id !== meId);
  const seconds = useCountdown({
    phase: room?.phase || "waiting",
    round: room?.round || 0,
    durationSec: room?.durationSec || 45,
    roundRemainingMs: room?.roundRemainingMs || 0,
    revealRemainingMs: room?.revealRemainingMs || 0,
    updatedAt: room?.updatedAt || 0,
  });

  if (!room) {
    return <JoiningStage code={session.code} onCancel={onCancelJoin} />;
  }

  if (room.phase === "waiting") {
    return (
      <WaitingStage
        room={room}
        session={session}
        connection={connection}
        onInvite={onInvite}
        onCopy={onCopy}
        onStart={onStart}
      />
    );
  }

  return (
    <main className="game-screen">
      <section className="game-main">
        {room.phase === "playing" ? (
          <WritingStage
            room={room}
            myPlayer={myPlayer}
            opponent={opponent}
            seconds={seconds}
            onSubmit={onSubmit}
          />
        ) : (
          <RevealStage
            room={room}
            myPlayer={myPlayer}
            opponent={opponent}
            seconds={seconds}
            onPlayAgain={onPlayAgain}
            isHost={isHost}
          />
        )}
      </section>
      <HistoryPanel history={room.history} meId={meId} />
    </main>
  );
}

function InviteModal({ code, onClose, notify }) {
  const shareUrl = getRoomUrl(code);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    QRCode.toDataURL(shareUrl, {
      width: 560,
      margin: 1,
      color: { dark: "#17201c", light: "#f2f4ef" },
    })
      .then(setQrUrl)
      .catch(() => setQrUrl(""));
  }, [shareUrl]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify("邀请链接已复制");
    } catch {
      notify("请长按或手动复制链接", "error");
    }
  }

  async function shareLink() {
    if (!navigator.share) {
      copyLink();
      return;
    }
    try {
      await navigator.share({
        title: "同词相见",
        text: `来房间 ${code}，和我玩一局同词相见。`,
        url: shareUrl,
      });
    } catch (error) {
      if (error?.name !== "AbortError") copyLink();
    }
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭邀请" />
      <div className="invite-modal">
        <button className="modal-close" type="button" onClick={onClose} title="关闭" aria-label="关闭">
          <X size={19} />
        </button>
        <div className="section-number">INVITE / {code}</div>
        <h2 id="invite-title">把这扇门交给朋友</h2>
        <p>打开链接或扫码，输入昵称就能进入这间房。</p>
        <div className="qr-frame">
          {qrUrl ? <img src={qrUrl} alt={`房间 ${code} 的邀请二维码`} /> : <LoaderCircle className="spin" />}
        </div>
        <div className="share-url">{shareUrl}</div>
        <div className="modal-actions">
          <button type="button" className="primary-button" onClick={shareLink}>
            <Share2 size={18} />
            分享邀请
          </button>
          <button type="button" className="secondary-button" onClick={copyLink}>
            <Copy size={17} />
            复制链接
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const initialCode = useMemo(
    () => sanitizeCode(new URLSearchParams(window.location.search).get("room")),
    [],
  );
  const [screen, setScreen] = useState(initialCode ? "join" : "home");
  const [name, setName] = useState(getSavedName());
  const [duration, setDuration] = useState(45);
  const [code, setCode] = useState(initialCode);
  const [room, setRoom] = useState(null);
  const [connection, setConnection] = useState("idle");
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const clientRef = useRef(null);
  const didResume = useRef(false);
  const toastTimer = useRef(null);

  const notify = useCallback((text, tone = "info") => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const setRoomUrl = useCallback((roomCode) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", roomCode);
    window.history.replaceState({}, "", url);
  }, []);

  const clearRoomUrl = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.replaceState({}, "", url);
  }, []);

  const handleFatal = useCallback(
    (message) => {
      notify(message, "error");
      clientRef.current?.close();
      clientRef.current = null;
      setRoom(null);
      setSession(null);
      setConnection("idle");
      setScreen("join");
    },
    [notify],
  );

  const connectHost = useCallback(
    (hostRoom) => {
      const host = hostRoom.players.find((player) => player.id === hostRoom.hostId);
      const player = {
        id: getPlayerId(),
        name: host?.name || getSavedName() || "房主",
      };
      clientRef.current?.close();
      const client = new RoomClient({
        code: hostRoom.code,
        role: "host",
        player,
        initialHostRoom: hostRoom,
        onState: setRoom,
        onConnection: setConnection,
        onNotice: (message) => notify(message, "error"),
        onHostRoom: saveHostRoom,
        onFatal: handleFatal,
      });
      clientRef.current = client;
      const nextSession = { role: "host", code: hostRoom.code, player };
      setSession(nextSession);
      setCode(hostRoom.code);
      setRoom(toPublicRoom(hostRoom));
      setScreen("room");
      setRoomUrl(hostRoom.code);
      client.connect();
    },
    [handleFatal, notify, setRoomUrl],
  );

  const connectGuest = useCallback(
    ({ roomCode, guestName }) => {
      const player = { id: getPlayerId(), name: guestName };
      clientRef.current?.close();
      const client = new RoomClient({
        code: roomCode,
        role: "guest",
        player,
        onState: setRoom,
        onConnection: setConnection,
        onNotice: (message) => notify(message, "error"),
        onFatal: handleFatal,
      });
      clientRef.current = client;
      const nextSession = { role: "guest", code: roomCode, player };
      setSession(nextSession);
      setRoom(null);
      setScreen("room");
      setRoomUrl(roomCode);
      saveGuestSession(roomCode, player);
      client.connect();
    },
    [handleFatal, notify, setRoomUrl],
  );

  useEffect(() => {
    if (didResume.current || !initialCode) return;
    didResume.current = true;
    const hostRoom = loadHostRoom(initialCode);
    if (hostRoom?.hostId === getPlayerId()) {
      connectHost(hostRoom);
      return;
    }
    const guest = loadGuestSession(initialCode);
    if (guest?.name) {
      setName(guest.name);
    }
  }, [connectHost, initialCode]);

  useEffect(
    () => () => {
      clientRef.current?.close();
      window.clearTimeout(toastTimer.current);
    },
    [],
  );

  function handleCreate(event) {
    event.preventDefault();
    const finalName = cleanName(name);
    if (!finalName) {
      setError("先写一个昵称，朋友才知道是谁");
      return;
    }
    saveName(finalName);
    setName(finalName);
    setError("");
    setBusy(true);

    let roomCode = createRoomCode();
    for (let tries = 0; tries < 4 && loadHostRoom(roomCode); tries += 1) {
      roomCode = createRoomCode();
    }
    const hostRoom = createRoom({
      code: roomCode,
      hostId: getPlayerId(),
      hostName: finalName,
      durationSec: duration,
    });
    saveHostRoom(hostRoom);
    connectHost(hostRoom);
    setBusy(false);
  }

  function openJoin(codeValue = code) {
    const finalCode = sanitizeCode(codeValue);
    if (finalCode.length !== ROOM_CODE_LENGTH) {
      setError("房号是 6 位，再看看朋友发来的链接");
      return;
    }
    const guest = loadGuestSession(finalCode);
    if (!name && guest?.name) setName(guest.name);
    setCode(finalCode);
    setError("");
    setScreen("join");
  }

  function handleJoin(event) {
    event.preventDefault();
    const finalName = cleanName(name);
    const finalCode = sanitizeCode(code);
    if (finalCode.length !== ROOM_CODE_LENGTH) {
      setError("房号不完整");
      return;
    }
    if (!finalName) {
      setError("先留一个昵称");
      return;
    }
    saveName(finalName);
    setName(finalName);
    setError("");
    setBusy(true);
    connectGuest({ roomCode: finalCode, guestName: finalName });
    setBusy(false);
  }

  function handleBackHome() {
    clientRef.current?.close();
    clientRef.current = null;
    clearRoomUrl();
    setRoom(null);
    setSession(null);
    setScreen("home");
    setConnection("idle");
    setError("");
  }

  function handleLeave() {
    const leavingSession = session;
    const leavingClient = clientRef.current;
    clientRef.current = null;
    leavingClient?.leave();
    if (leavingSession?.role === "host") {
      removeHostRoom(leavingSession.code);
    } else if (leavingSession?.role === "guest") {
      removeGuestSession(leavingSession.code);
    }
    clearRoomUrl();
    setRoom(null);
    setSession(null);
    setScreen("home");
    setConnection("idle");
    setError("");
  }

  async function copyInvite() {
    const roomCode = session?.code || code;
    try {
      await navigator.clipboard.writeText(getRoomUrl(roomCode));
      notify("邀请链接已复制");
    } catch {
      notify("复制失败，请从邀请面板里手动复制", "error");
    }
  }

  function handleStart() {
    clientRef.current?.startGame();
  }

  function handleSubmit(word) {
    return clientRef.current?.submit(word) ?? false;
  }

  function handlePlayAgain() {
    clientRef.current?.playAgain();
  }

  function handleCancelJoin() {
    clientRef.current?.leave();
    clientRef.current = null;
    setRoom(null);
    setSession(null);
    setConnection("idle");
    if (screen === "room" && initialCode) {
      setScreen("join");
    } else {
      setScreen("home");
      clearRoomUrl();
    }
  }

  const headerMode = screen === "room" ? "room" : screen === "join" ? "join" : "home";

  return (
    <div className={`app-shell screen-${screen}`}>
      <AppHeader
        mode={headerMode}
        connection={connection}
        roomCode={session?.code || code}
        onLeave={handleLeave}
        onBack={handleBackHome}
      />

      {screen === "home" && (
        <HomeScreen
          name={name}
          onNameChange={(value) => {
            setName(value);
            setError("");
          }}
          duration={duration}
          onDurationChange={setDuration}
          code={code}
          onCodeChange={(value) => {
            setCode(value);
            setError("");
          }}
          error={error}
          busy={busy}
          onCreate={handleCreate}
          onJoinRequest={() => openJoin()}
        />
      )}

      {screen === "join" && (
        <JoinScreen
          code={code}
          onCodeChange={(value) => {
            setCode(value);
            setError("");
          }}
          name={name}
          onNameChange={(value) => {
            setName(value);
            setError("");
          }}
          error={error}
          joining={busy}
          onJoin={handleJoin}
          onBack={handleBackHome}
        />
      )}

      {screen === "room" && session && (
        <RoomScreen
          room={room}
          session={session}
          connection={connection}
          onStart={handleStart}
          onSubmit={handleSubmit}
          onInvite={() => setInviteOpen(true)}
          onCopy={copyInvite}
          onPlayAgain={handlePlayAgain}
          onCancelJoin={handleCancelJoin}
        />
      )}

      {inviteOpen && session && (
        <InviteModal
          code={session.code}
          onClose={() => setInviteOpen(false)}
          notify={notify}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />

      <footer className="app-footer">
        <span>同词相见 · 两个人的默契实验</span>
        <span>
          <i />
          房间链接就是邀请函
        </span>
      </footer>
    </div>
  );
}
