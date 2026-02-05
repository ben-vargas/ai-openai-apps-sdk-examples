import { useCallback, useState } from "react";
import { getAssetsBaseUrl } from "./api-base-url";
import cardBackPattern from "./assets/card-back-pattern.png";
import { usePipCardManagement, usePipCardState } from "./pip-card-management";

interface AbsPipCardProps {
  id: string;
  children: React.ReactNode;
  onClick?: () => void;
  invertColors?: boolean;
  isWinner?: boolean;
  isHandCard?: boolean;
}

export function AbsPipCard({
  id,
  children,
  onClick,
  invertColors = false,
  isWinner = false,
  isHandCard = false,
}: AbsPipCardProps) {
  const cardState = usePipCardState(id);
  const { handleCardTransitionEnd } = usePipCardManagement();
  const [hovered, setHovered] = useState(false);

  const onTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.propertyName !== "transform") return;
      handleCardTransitionEnd(id);
    },
    [handleCardTransitionEnd, id],
  );

  const { x, y, rotation, faceUp, interactive } = cardState;

  // Hand card hover: lift up and straighten
  const isHoverLifted = hovered && isHandCard;
  const outerTransform = isHoverLifted
    ? `translate3d(${x}px, ${y}px, 0px) rotate(0deg) translateY(-18px)`
    : `translate3d(${x}px, ${y}px, 0px) rotate(${rotation}deg)`;
  const outerZIndex = isHoverLifted ? 30 : undefined;

  const assetsBaseUrl = getAssetsBaseUrl();
  const cardBackPatternUrl = assetsBaseUrl
    ? new URL(cardBackPattern, assetsBaseUrl).toString()
    : cardBackPattern;

  const invertClasses = invertColors ? " invert" : "";

  const baseFaceClasses =
    "flex h-full w-full items-start rounded-2xl border border-black bg-white bg-gradient-to-b from-slate-50 to-white px-3 py-2.5 text-left text-black outline-none";
  const interactiveFaceClasses = interactive
    ? "cursor-pointer hover:border-sky-300 focus:border-2 focus:border-sky-300 focus:outline-none active:scale-95"
    : "cursor-default";
  const winnerFaceClasses = isWinner
    ? "outline-[6px] outline-solid outline-[rgb(250,204,21)] outline-offset-0"
    : "";

  const face = interactive ? (
    <button
      type="button"
      className={`${baseFaceClasses} ${interactiveFaceClasses} ${winnerFaceClasses}${invertClasses}`}
      onClick={onClick}
    >
      {children}
    </button>
  ) : (
    <div
      className={`${baseFaceClasses} ${interactiveFaceClasses} ${winnerFaceClasses}${invertClasses}`}
    >
      {children}
    </div>
  );

  // Winner glow on the flight div
  const flightClasses = isWinner
    ? "h-full w-full rounded-2xl [transform-style:preserve-3d] shadow-[0_0_10px_2px_rgba(250,204,21,0.7)] [animation:cards-ai-winner-glow_1.8s_ease-in-out_infinite]"
    : "h-full w-full rounded-2xl [transform-style:preserve-3d] shadow-[0_12px_30px_-10px_rgba(15,23,42,0.55)]";

  return (
    <div
      className="absolute left-0 top-0 h-[193px] w-[138px] text-sm font-semibold [perspective:1200px] [transform-style:preserve-3d] [transition:transform_600ms_cubic-bezier(0.24,0.96,0.38,1)]"
      style={{
        transform: outerTransform,
        zIndex: outerZIndex,
      }}
      onTransitionEnd={onTransitionEnd}
      onMouseEnter={isHandCard ? () => setHovered(true) : undefined}
      onMouseLeave={isHandCard ? () => setHovered(false) : undefined}
    >
      {/* Card inner (flip) */}
      <div
        className="relative h-full w-full [transform-style:preserve-3d] [transition:transform_300ms_ease]"
        style={{ transform: `rotateY(${faceUp ? "0deg" : "180deg"})` }}
      >
        {/* Front face */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <div className={flightClasses}>{face}</div>
        </div>
        {/* Back face */}
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div
            className={`h-full w-full rounded-2xl border border-white bg-center bg-cover shadow-[0_12px_30px_-10px_rgba(15,23,42,0.55)]${invertClasses}`}
            style={{ backgroundImage: `url(${cardBackPatternUrl})` }}
          />
        </div>
      </div>
    </div>
  );
}
