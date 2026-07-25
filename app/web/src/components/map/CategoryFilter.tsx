import { ALL_CATEGORIES } from '@/constants/categoryColors';

interface CategoryFilterProps {
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

export function CategoryFilter({ activeCategory, onCategoryChange }: CategoryFilterProps) {
  return (
    <div className="flex gap-1 overflow-x-auto px-3 py-2 scrollbar-hide">
      {ALL_CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onCategoryChange(cat.id)}
          className={`
            px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap
            flex items-center gap-1.5 transition-all
            ${activeCategory === cat.id
              ? 'bg-white text-black shadow-sm'
              : 'glass-control text-white/70 hover:text-white border-0'
            }
          `}
          style={{ transitionDuration: 'var(--duration-fast)' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: cat.color }}
            aria-hidden="true"
          />
          {cat.label}
        </button>
      ))}
    </div>
  );
}
