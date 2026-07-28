import type { SearchableTag } from "@yomi/shared";

export type TagModifier = "+" | "-" | "~";
export type BlockingGroup =
  | "AI-Generated"
  | "Animal-Related"
  | "Non-Consentual"
  | "Gore"
  | "Scat"
  | "Vore"
  | "Incest";

export const BLOCKING_GROUP_TAGS: Record<BlockingGroup, readonly string[]> = {
  "AI-Generated": ["ai_generated"],
  "Animal-Related": [
    "zoophilia",
    "zoo",
    "canine*",
    "equine*",
    "*feral*",
    "bestiality",
    "animal",
  ],
  "Non-Consentual": [
    "captive",
    "captured",
    "defeated",
    "rape",
    "*_slave",
    "no_consent",
    "molestation",
    "non-con*",
    "scared",
    "forced",
  ],
  Gore: ["gore", "necrophilia", "amputee", "guro", "blood"],
  Scat: ["scat", "diaper", "fart"],
  Vore: ["vore"],
  Incest: [
    "incest",
    "brother",
    "sister",
    "mother",
    "father",
    "daughter",
    "son",
    "family",
  ],
};

export const serializeModifier = (value: TagModifier) =>
  value === "-" ? "-" : "";

export const serializeTagName = (value: string) => value.replaceAll(" ", "_");

export const serializeSearchableTag = (tag: SearchableTag) =>
  `${serializeModifier(tag.modifier)}${serializeTagName(tag.name)}`;

export const serializeSearchableTags = (tags: SearchableTag[]) => {
  const partitions: Record<TagModifier, SearchableTag[]> = {
    "+": [],
    "-": [],
    "~": [],
  };
  for (const t of tags) partitions[t.modifier].push(t);

  const parts = [...partitions["+"], ...partitions["-"]].map(
    serializeSearchableTag,
  );
  if (partitions["~"].length > 0) {
    parts.push(
      `( ${partitions["~"].map(serializeSearchableTag).join(" ~ ")} )`,
    );
  }
  return parts.join(" ");
};

export function parseTagString(q: string): SearchableTag[] {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token.startsWith("-"))
        return { name: token.slice(1), modifier: "-" as const };
      if (token.startsWith("~"))
        return { name: token.slice(1), modifier: "~" as const };
      return { name: token, modifier: "+" as const };
    });
}

export function applyBlockingGroups(
  tags: SearchableTag[],
  groups: BlockingGroup[],
): SearchableTag[] {
  const blocked: SearchableTag[] = groups
    .filter((g) => g in BLOCKING_GROUP_TAGS)
    .flatMap((g) =>
      BLOCKING_GROUP_TAGS[g].map((name) => ({ name, modifier: "-" as const })),
    );
  return [...tags, ...blocked];
}

export function serializeSearch(
  tags: SearchableTag[],
  opts: {
    sort?: string;
    rating?: string;
    blocked?: BlockingGroup[];
  } = {},
): string[] {
  const parts: string[] = [];
  if (opts.sort) parts.push(`sort:${opts.sort}`);
  if (opts.rating && opts.rating !== "all") parts.push(`rating:${opts.rating}`);

  const allTags = opts.blocked?.length
    ? applyBlockingGroups(tags, opts.blocked)
    : tags;
  if (allTags.length) {
    const serialized = serializeSearchableTags(allTags);
    if (serialized.trim()) parts.push(...serialized.split(" ").filter(Boolean));
  }
  return parts;
}
