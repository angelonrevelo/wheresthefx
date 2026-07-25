import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInterestTags } from "@/hooks/useInterestTags";
import { Loader2 } from "lucide-react";

interface InterestTagSelectorProps {
  onComplete: (selectedTags: string[]) => void;
}

export function InterestTagSelector({ onComplete }: InterestTagSelectorProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { data: tags, isLoading } = useInterestTags();
  
  const toggleTag = (tagName: string) => {
    setSelectedTags(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };
  
  const handleContinue = () => {
    onComplete(selectedTags);
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">What interests you?</h3>
        <p className="text-sm text-muted-foreground">
          Select tags to personalize your event feed
        </p>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {tags?.map((tag) => (
          <Badge
            key={tag.id}
            variant={selectedTags.includes(tag.name) ? "default" : "outline"}
            className="cursor-pointer px-3 py-2 text-sm hover:scale-105 transition-transform"
            onClick={() => toggleTag(tag.name)}
          >
            {tag.name}
          </Badge>
        ))}
      </div>
      
      <Button
        onClick={handleContinue}
        className="w-full"
        disabled={selectedTags.length === 0}
      >
        Continue {selectedTags.length > 0 && `(${selectedTags.length} selected)`}
      </Button>
    </div>
  );
}
