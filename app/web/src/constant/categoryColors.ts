// Category color hex values
export const CATEGORY_COLORS: Record<string, string> = {
  nightlife: '#9B59B6',   // Purple
  music: '#E74C3C',       // Red
  arts: '#00BCD4',        // Cyan
  film: '#FF5722',        // Deep Orange
  comedy: '#009688',      // Teal
  food: '#FFEB3B',        // Yellow
  markets: '#FF9800',     // Orange
  sports: '#2196F3',      // Blue
  fitness: '#00E676',     // Light Green
  workshops: '#4CAF50',   // Green
  tech: '#03A9F4',        // Light Blue
  community: '#E91E63',   // Pink
  // Legacy mappings
  art_culture: '#00BCD4',
  gaming: '#2196F3',
  other: '#9E9E9E',
};

// Human-readable labels
export const CATEGORY_LABELS: Record<string, string> = {
  nightlife: 'Nightlife',
  music: 'Music',
  arts: 'Arts',
  film: 'Film',
  comedy: 'Comedy',
  food: 'Food',
  markets: 'Markets',
  sports: 'Sports',
  fitness: 'Fitness',
  workshops: 'Workshops',
  tech: 'Tech',
  community: 'Community',
  // Legacy
  art_culture: 'Arts',
  gaming: 'Sports',
  other: 'Other',
};

// CSS filter strings to colorize the marker icon
const CATEGORY_FILTERS: Record<string, string> = {
  '#9B59B6': 'brightness(0) saturate(100%) invert(34%) sepia(98%) saturate(4764%) hue-rotate(280deg) brightness(95%) contrast(94%)', // Purple
  '#E74C3C': 'brightness(0) saturate(100%) invert(27%) sepia(51%) saturate(2878%) hue-rotate(346deg) brightness(104%) contrast(97%)', // Red
  '#00BCD4': 'brightness(0) saturate(100%) invert(70%) sepia(67%) saturate(456%) hue-rotate(140deg) brightness(93%) contrast(101%)', // Cyan
  '#FF9800': 'brightness(0) saturate(100%) invert(58%) sepia(89%) saturate(1095%) hue-rotate(360deg) brightness(100%) contrast(106%)', // Orange
  '#FFEB3B': 'brightness(0) saturate(100%) invert(88%) sepia(62%) saturate(497%) hue-rotate(359deg) brightness(103%) contrast(104%)', // Yellow
  '#4CAF50': 'brightness(0) saturate(100%) invert(55%) sepia(43%) saturate(544%) hue-rotate(93deg) brightness(94%) contrast(92%)', // Green
  '#E91E63': 'brightness(0) saturate(100%) invert(26%) sepia(82%) saturate(2841%) hue-rotate(326deg) brightness(96%) contrast(98%)', // Pink
  '#009688': 'brightness(0) saturate(100%) invert(40%) sepia(52%) saturate(533%) hue-rotate(131deg) brightness(95%) contrast(101%)', // Teal
  '#2196F3': 'brightness(0) saturate(100%) invert(44%) sepia(98%) saturate(1500%) hue-rotate(196deg) brightness(100%) contrast(96%)', // Blue
  '#00E676': 'brightness(0) saturate(100%) invert(70%) sepia(70%) saturate(600%) hue-rotate(100deg) brightness(100%) contrast(95%)', // Light Green
  '#FF5722': 'brightness(0) saturate(100%) invert(35%) sepia(80%) saturate(3000%) hue-rotate(350deg) brightness(100%) contrast(95%)', // Deep Orange
  '#03A9F4': 'brightness(0) saturate(100%) invert(55%) sepia(85%) saturate(800%) hue-rotate(170deg) brightness(100%) contrast(95%)', // Light Blue
  '#9E9E9E': 'brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%) contrast(90%)', // Gray
};

// Helper to get CSS filter from category
export function getCategoryFilter(category: string): string {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.community;
  return CATEGORY_FILTERS[color] || CATEGORY_FILTERS['#9E9E9E'];
}

// All categories for filter UI
export const ALL_CATEGORIES = [
  { id: 'all', label: 'All', color: '#FFFFFF' },
  { id: 'nightlife', label: 'Nightlife', color: '#9B59B6' },
  { id: 'music', label: 'Music', color: '#E74C3C' },
  { id: 'arts', label: 'Arts', color: '#00BCD4' },
  { id: 'film', label: 'Film', color: '#FF5722' },
  { id: 'comedy', label: 'Comedy', color: '#009688' },
  { id: 'food', label: 'Food', color: '#FFEB3B' },
  { id: 'markets', label: 'Markets', color: '#FF9800' },
  { id: 'sports', label: 'Sports', color: '#2196F3' },
  { id: 'fitness', label: 'Fitness', color: '#00E676' },
  { id: 'workshops', label: 'Workshops', color: '#4CAF50' },
  { id: 'tech', label: 'Tech', color: '#03A9F4' },
  { id: 'community', label: 'Community', color: '#E91E63' },
];
