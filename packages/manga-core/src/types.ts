export interface Chapter {
  id: number | string;
  name: string;
  title: string | null;
  slug: string;
  thumbnail: string;
  price: number;
  isFree: boolean;
  createdAt: string;
  index: string;
  url: string;
}

export interface ChapterData {
  id: number | string;
  name: string;
  title: string | null;
  slug: string;
  index: string;
  price: number;
  isFree: boolean;
  thumbnail: string;
  images: string[];
  pageCount: number;
  createdAt: string;
  headerForImage?: Record<string, string>;
  series: {
    id: number | string;
    title: string;
    slug: string;
    thumbnail: string;
    status: string;
    description: string;
  };
}

export interface Series {
  id: number | string;
  title: string;
  slug: string;
  description: string;
  thumbnail: string;
  cover: string;
  status: string;
  type: string;
  rating: number;
  totalViews: number;
  alternativeNames: string;
  author: string;
  studio: string;
  releaseYear: string;
  releaseSchedule: string[];
  tags: string[];
  chaptersCount: number;
  bookmarksCount: number;
  isComingSoon: boolean;
  badge: string | null;
  createdAt: string;
  updatedAt: string;
  chapters: Chapter[];
  url: string;
  provider: string;
  imageHeaders?: Record<string, string>;
}

export interface MangaSearchResult {
  id: string;
  title: string;
  image: string;
  provider: string;
  imageHeaders?: Record<string, string>;
  sourceIds?: Partial<
    Record<"mangafire" | "weebcentral" | "omegascans", string>
  >;
  sources?: Array<{
    provider: "mangafire" | "weebcentral" | "omegascans";
    id: string;
    title: string;
    image: string;
  }>;
}

export interface MangaSearchPage {
  results: MangaSearchResult[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    hasNextPage: boolean;
  };
  sources?: Array<{
    provider: "mangafire" | "weebcentral" | "omegascans";
    status: "fulfilled" | "rejected";
    count: number;
    error?: string;
  }>;
}
