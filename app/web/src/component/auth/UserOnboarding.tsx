import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/component/ui/dialog";
import { WordCloud } from "@/component/shared";
import { InterestTagSelector } from "@/component/shared/InterestTagSelector";
import { usePopularAccounts } from "@/hook/usePopularAccounts";
import { useUserPreferences } from "@/hook/useUserPreferences";
import { Button } from "@/component/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UserOnboardingProps {
  open: boolean;
  onComplete: (selectedTags: string[]) => void;
}

export function UserOnboarding({ open, onComplete }: UserOnboardingProps) {
  const [step, setStep] = useState<'accounts' | 'tags'>('accounts');
  const { data: accounts, isLoading: accountsLoading } = usePopularAccounts(30);
  const { updatePreference } = useUserPreferences();
  
  const handleAccountsNext = () => {
    setStep('tags');
  };
  
  const handleTagsComplete = (selectedTags: string[]) => {
    updatePreference(selectedTags);
    
    toast.success("Preferences saved! Your map is now personalized.");
    onComplete(selectedTags);
  };
  
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        {step === 'accounts' ? (
          <>
            <DialogHeader>
              <DialogTitle>Welcome! Here are popular event accounts</DialogTitle>
            </DialogHeader>
            
            {accountsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <WordCloud account={accounts || []} />
                <Button onClick={handleAccountsNext} className="w-full">
                  Next
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Personalize Your Experience</DialogTitle>
            </DialogHeader>
            <InterestTagSelector onComplete={handleTagsComplete} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
