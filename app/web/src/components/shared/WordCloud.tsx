import { useMemo } from "react";

interface WordCloudProps {
  accounts: Array<{
    username: string;
    engagement_score: number;
  }>;
}

export function WordCloud({ accounts }: WordCloudProps) {
  const words = useMemo(() => {
    if (!accounts || accounts.length === 0) return [];
    
    // Normalize engagement scores to font sizes
    const maxScore = Math.max(...accounts.map(a => a.engagement_score));
    const minScore = Math.min(...accounts.map(a => a.engagement_score));
    
    return accounts.map(account => {
      const normalizedSize = ((account.engagement_score - minScore) / (maxScore - minScore)) * 100;
      const fontSize = 12 + (normalizedSize / 100) * 24; // 12px to 36px
      
      return {
        text: `@${account.username}`,
        size: fontSize,
      };
    });
  }, [accounts]);
  
  return (
    <div className="flex flex-wrap gap-3 justify-center items-center p-6">
      {words.map((word, index) => (
        <span
          key={index}
          className="text-foreground/80 font-medium animate-fade-in hover:text-primary transition-colors cursor-default"
          style={{
            fontSize: `${word.size}px`,
            animationDelay: `${index * 0.05}s`,
          }}
        >
          {word.text}
        </span>
      ))}
    </div>
  );
}
