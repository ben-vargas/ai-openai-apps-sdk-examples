import { Persona, Player } from "./types";

export async function* fetchPlayers(): AsyncGenerator<Player> {
    throw new Error("Not implemented");
}

interface PersonaTemplate {
    name: string;
    personality: string;
    likes: string[];
    dislikes: string[];
    humorStyle: string[];
    favoriteJokeTypes: string[];
}

const PERSONA_TEMPLATES: PersonaTemplate[] = [
    {
        name: "You",
        personality: "Wry, observant, and quick to find the punchline.",
        likes: ["clever callbacks", "unexpected twists", "memes with lore"],
        dislikes: ["low-effort punchlines", "awkward silence", "cold coffee"],
        humorStyle: ["deadpan", "meta", "dry"],
        favoriteJokeTypes: ["wordplay", "call-backs", "absurdist"],
    },
    {
        name: "Sam",
        personality: "Chaotic good with a knack for overcommitting to the bit.",
        likes: ["grand gestures", "inside jokes", "theater kid energy"],
        dislikes: ["boring rules", "tiny talk", "long waits"],
        humorStyle: ["dramatic", "energetic", "self-aware"],
        favoriteJokeTypes: ["slapstick", "exaggeration", "improv"],
    },
    {
        name: "Priya",
        personality: "Chill, clever, and deceptively competitive.",
        likes: ["quick wit", "bold risks", "clean setups"],
        dislikes: ["cheap shots", "rambling stories", "buzzkill vibes"],
        humorStyle: ["sarcastic", "playful", "sharp"],
        favoriteJokeTypes: ["one-liners", "misdirection", "dark humor"],
    },
    {
        name: "Diego",
        personality: "Laid-back with a sneaky sense of mischief.",
        likes: ["long jokes", "callbacks", "ridiculous imagery"],
        dislikes: ["spoilers", "puns that try too hard", "rules lawyering"],
        humorStyle: ["storyteller", "absurd", "deadpan"],
        favoriteJokeTypes: ["narrative", "escalation", "surreal"],
    },
    {
        name: "Maya",
        personality: "Earnest but ruthless in pursuit of the funniest answer.",
        likes: ["clever pairings", "bold moves", "unexpected sincerity"],
        dislikes: ["predictable jokes", "rude vibes", "messy setups"],
        humorStyle: ["wholesome", "clever", "offbeat"],
        favoriteJokeTypes: ["observational", "contrast", "heartfelt absurdity"],
    },
];

function createPersona(id: string, template: PersonaTemplate): Persona {
    return {
        id,
        name: template.name,
        personality: template.personality,
        likes: template.likes,
        dislikes: template.dislikes,
        humorStyle: template.humorStyle,
        favoriteJokeTypes: template.favoriteJokeTypes,
    };
}

function createPlayer(id: string, personaId: string, template: PersonaTemplate, type: Player["type"]): Player {
    return {
        id,
        type,
        persona: createPersona(personaId, template),
        answerCards: [],
        wonPromptCards: [],
    };
}

export function createFakePlayers(): Player[] {
    const players: Player[] = [];
    let index = 0;

    for (const template of PERSONA_TEMPLATES) {
        const paddedIndex = String(index + 1).padStart(3, "0");
        const playerId = `player-${paddedIndex}`;
        const personaId = `persona-${paddedIndex}`;
        const type: Player["type"] = index === 0 ? "human" : "cpu";

        players.push(createPlayer(playerId, personaId, template, type));
        index += 1;
    }

    return players;
}

const FAKE_PLAYERS: Player[] = createFakePlayers();

export async function* fetchFakePlayers(): AsyncGenerator<Player> {
    const fetchedPlayers: Player[] = [];

    while (fetchedPlayers.length < 4) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const player = FAKE_PLAYERS[fetchedPlayers.length];
        fetchedPlayers.push(player);
        yield player;
    }
}