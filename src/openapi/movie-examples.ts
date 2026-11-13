import { PAGE_SIZE } from '../http/pagination.js';
import type { MovieDetails, MovieListResponse } from '../movies/schemas.js';

// Real responses from the supplied databases, truncated to three movies.
// Tests check them against the databases so the documentation can't drift.

/** Page 1, no filters. */
export const FIRST_PAGE_EXAMPLE: MovieListResponse = {
  data: [
    {
      movieId: 2,
      imdbId: 'tt0094675',
      title: 'Ariel',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 80, name: 'Crime' },
      ],
      releaseDate: '1988-10-21',
      budget: '$0',
    },
    {
      movieId: 3,
      imdbId: 'tt0092149',
      title: 'Shadows in Paradise',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1986-10-16',
      budget: '$0',
    },
    {
      movieId: 5,
      imdbId: 'tt0113101',
      title: 'Four Rooms',
      genres: [
        { id: 80, name: 'Crime' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1995-12-09',
      budget: '$4,000,000',
    },
  ],
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 45430, totalPages: 909 },
};

/** 1999 was chosen because many of its movies share 1999-01-01, which shows the movieId tie-break. */
export const YEAR_1999_EXAMPLES = {
  asc: {
    data: [
      {
        movieId: 3144,
        imdbId: 'tt0183717',
        title: "Rock 'n' Roll Frankenstein",
        genres: [
          { id: 35, name: 'Comedy' },
          { id: 27, name: 'Horror' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 15752,
        imdbId: 'tt0211219',
        title: 'Barenaked in America',
        genres: [{ id: 99, name: 'Documentary' }],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 18143,
        imdbId: 'tt0373960',
        title: 'She and Her Cat: Their Standing Points',
        genres: [
          { id: 16, name: 'Animation' },
          { id: 10749, name: 'Romance' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 723, totalPages: 15 },
  },
  desc: {
    data: [
      {
        movieId: 105980,
        imdbId: 'tt0129023',
        title: 'Dark Harbor',
        genres: [
          { id: 53, name: 'Thriller' },
          { id: 18, name: 'Drama' },
        ],
        releaseDate: '1999-12-31',
        budget: '$0',
      },
      {
        movieId: 56828,
        imdbId: 'tt0293092',
        title: "Dexter's Laboratory: Ego Trip",
        genres: [
          { id: 16, name: 'Animation' },
          { id: 35, name: 'Comedy' },
          { id: 10751, name: 'Family' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1999-12-31',
        budget: '$0',
      },
      {
        movieId: 41245,
        imdbId: 'tt0247613',
        title: 'Peppermint Candy',
        genres: [{ id: 18, name: 'Drama' }],
        releaseDate: '1999-12-31',
        budget: '$0',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 723, totalPages: 15 },
  },
} satisfies Record<'asc' | 'desc', MovieListResponse>;

/** A valid year with no movies. */
export const EMPTY_YEAR_EXAMPLE = {
  year: 1850,
  response: {
    data: [],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 },
  },
} satisfies { year: number; response: MovieListResponse };

export const GENRE_EXAMPLES = {
  action: {
    data: [
      {
        movieId: 6,
        imdbId: 'tt0107286',
        title: 'Judgment Night',
        genres: [
          { id: 28, name: 'Action' },
          { id: 53, name: 'Thriller' },
          { id: 80, name: 'Crime' },
        ],
        releaseDate: '1993-10-15',
        budget: '$0',
      },
      {
        movieId: 11,
        imdbId: 'tt0076759',
        title: 'Star Wars',
        genres: [
          { id: 12, name: 'Adventure' },
          { id: 28, name: 'Action' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1977-05-25',
        budget: '$11,000,000',
      },
      {
        movieId: 18,
        imdbId: 'tt0119116',
        title: 'The Fifth Element',
        genres: [
          { id: 12, name: 'Adventure' },
          { id: 14, name: 'Fantasy' },
          { id: 28, name: 'Action' },
          { id: 53, name: 'Thriller' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1997-05-07',
        budget: '$90,000,000',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 6590, totalPages: 132 },
  },
  action1999: {
    data: [
      {
        movieId: 25660,
        imdbId: 'tt0223530',
        title: 'Nowhere to Hide',
        genres: [
          { id: 28, name: 'Action' },
          { id: 35, name: 'Comedy' },
          { id: 80, name: 'Crime' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 30817,
        imdbId: 'tt0181838',
        title: 'Stealth Fighter',
        genres: [
          { id: 28, name: 'Action' },
          { id: 53, name: 'Thriller' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 31501,
        imdbId: 'tt0203082',
        title: 'Samurai X: Trust & Betrayal',
        genres: [
          { id: 16, name: 'Animation' },
          { id: 28, name: 'Action' },
          { id: 12, name: 'Adventure' },
          { id: 18, name: 'Drama' },
          { id: 10749, name: 'Romance' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 100, totalPages: 2 },
  },
} satisfies Record<string, MovieListResponse>;

/**
 * Star Wars shows the naive rating match. Capote shows a `null` rating and the
 * malformed-company fallback.
 */
export const DETAILS_EXAMPLES = {
  11: {
    movieId: 11,
    imdbId: 'tt0076759',
    title: 'Star Wars',
    description:
      'Princess Leia is captured and held hostage by the evil Imperial forces in their effort ' +
      'to take over the galactic Empire. Venturesome Luke Skywalker and dashing captain Han ' +
      'Solo team together with the loveable robot duo R2-D2 and C-3PO to rescue the beautiful ' +
      'princess and restore peace and justice in the Empire.',
    releaseDate: '1977-05-25',
    budget: '$11,000,000',
    runtime: 121,
    averageRating: 3.69,
    genres: [
      { id: 12, name: 'Adventure' },
      { id: 28, name: 'Action' },
      { id: 878, name: 'Science Fiction' },
    ],
    originalLanguage: null,
    productionCompanies: [
      { id: 1, name: 'Lucasfilm' },
      { id: 306, name: 'Twentieth Century Fox Film Corporation' },
    ],
  },
  398: {
    movieId: 398,
    imdbId: 'tt0379725',
    title: 'Capote',
    description:
      "A biopic of the writer, Truman Capote and his assignment for The New Yorker to write the non-fiction book, 'In Cold Blood'.",
    releaseDate: '2005-09-30',
    budget: '$7,000,000',
    runtime: 114,
    averageRating: null,
    genres: [
      { id: 80, name: 'Crime' },
      { id: 18, name: 'Drama' },
    ],
    originalLanguage: null,
    productionCompanies: [],
  },
} satisfies Record<number, MovieDetails>;
