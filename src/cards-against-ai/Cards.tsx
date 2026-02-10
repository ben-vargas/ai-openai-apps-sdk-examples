import { getAssetsBaseUrl } from "./api-base-url";
import cardBackPattern from "./assets/card-back-pattern.png";

/**
 * The width and height of a card in pixels.
 */
export const CARD_WIDTH = 138;
export const CARD_HEIGHT = 193;


export interface CardProps {
    x: number;
    y: number;
    rotation: number;
    faceUp: boolean;
    children: React.ReactNode;
}

const baseFaceClasses =
    "flex h-full w-full items-start rounded-2xl border border-black bg-white bg-gradient-to-b from-slate-50 to-white px-3 py-2.5 text-left text-black outline-none";

/**
 * A base card component that is used to get the general layout and positioning of a card.
 * The child components are displayed on the face of the card. All animations, flipping, etc,
 * are controlled with CSS transitions and/or keyframe animations.
*/
export function Card({ x, y, rotation, faceUp, children }: CardProps) {
    const assetsBaseUrl = getAssetsBaseUrl();
    const cardBackPatternUrl = assetsBaseUrl
        ? new URL(cardBackPattern, assetsBaseUrl).toString()
        : cardBackPattern;

    return (
        <div
            className="absolute left-0 top-0 text-sm font-semibold [perspective:1200px] [transform-style:preserve-3d] [transition:transform_600ms_cubic-bezier(0.24,0.96,0.38,1)]"
            style={{
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                transform: `translate3d(${x}px, ${y}px, 0px) rotate(${rotation}deg)`,
            }}
        >
            {/* Card inner (flip) */}
            <div
                className="relative h-full w-full [transform-style:preserve-3d] [transition:transform_300ms_ease]"
                style={{ transform: `rotateY(${faceUp ? "0deg" : "180deg"})` }}
            >
                {/* Front face */}
                <div className="absolute inset-0 [backface-visibility:hidden]">
                    <div className="h-full w-full rounded-2xl [transform-style:preserve-3d] shadow-[0_12px_30px_-10px_rgba(15,23,42,0.55)]">
                        {children}
                    </div>
                </div>
                {/* Back face */}
                <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                    <div
                        className="h-full w-full rounded-2xl border border-white bg-center bg-cover shadow-[0_12px_30px_-10px_rgba(15,23,42,0.55)]"
                        style={{ backgroundImage: `url(${cardBackPatternUrl})` }}
                    />
                </div>
            </div>
        </div>
    );
}

export interface AnswerCardProps extends Omit<CardProps, 'children'> {
    /**
     * The answer text to display on the card.
     */
    text: string;
    /**
     * Whether the card is interactive. If true, the card will be clickable
     */
    interactive?: boolean;
    /**
     * The function to call when the card is clicked.
     * Only works if interactive is true.
     */
    onClick?: () => void;
}

/**
 * An answer card that is used to display answer text to the players,
 * as well as to allow the player to interact with the card (if interactive is true).
 */
export function AnswerCard({ x, y, rotation, faceUp, interactive, text, onClick }: AnswerCardProps) {
    return (
        <Card x={x} y={y} rotation={rotation} faceUp={faceUp}>
            {interactive ? (
                <button
                    type="button"
                    className={`${baseFaceClasses} cursor-pointer`}
                    onClick={onClick}
                >
                    {text}
                </button>
            ) : (
                <div className={`${baseFaceClasses} cursor-default`}>
                    {text}
                </div>
            )}
        </Card>
    );
}

export interface PromptCardProps extends Omit<CardProps, 'children'> {
    /**
     * The prompt text to display.
     */
    text: string;
    children?: React.ReactNode;
}


/**
 * A prompt card that is used to display promp text to the players.
 */
export function PromptCard({ x, y, rotation, faceUp, text, children }: PromptCardProps) {
    return (
        <Card x={x} y={y} rotation={rotation} faceUp={faceUp}>
            <div className={`${baseFaceClasses} invert`}>
                {text}
                {children}
            </div>
        </Card>
    );
}

export interface CardsProps {
    children: React.ReactNode;
}

/**
 * This is a container that manages the positioning of the cards in the play area.
 * It will take up the entire width and height if its parent. Cards are positoined
 * using translate3d and rotation for performance reasons. All animations are controlled
 * with CSS transitions and/or keyframe animations.
 */
export function Cards({ children }: CardsProps) {
    return (
        <div className="relative h-full w-full">
            {children}
        </div>
    );
}
