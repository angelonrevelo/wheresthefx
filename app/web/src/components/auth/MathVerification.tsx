import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface MathQuestion {
  question: string;
  answer: number;
}

const generateQuestion = (): MathQuestion => {
  const operations = [
    { symbol: "+", fn: (a: number, b: number) => a + b },
    { symbol: "-", fn: (a: number, b: number) => a - b },
    { symbol: "×", fn: (a: number, b: number) => a * b },
  ];
  
  let answer = 50;
  let question = "";
  
  // Keep generating until answer is less than 50
  while (answer >= 50) {
    const x = Math.floor(Math.random() * 5) + 1; // 1-5
    const coefficient = Math.floor(Math.random() * 3) + 2; // 2-4
    const operation = operations[Math.floor(Math.random() * operations.length)];
    const secondNum = Math.floor(Math.random() * 8) + 1; // 1-8
    
    answer = operation.fn(coefficient * x, secondNum);
    question = `If f(x) = ${coefficient}x ${operation.symbol} ${secondNum}, what is f(${x})?`;
  }
  
  return { question, answer };
};

interface MathVerificationProps {
  onVerified: () => void;
}

export const MathVerification = ({ onVerified }: MathVerificationProps) => {
  const [mathQuestion, setMathQuestion] = useState<MathQuestion>(generateQuestion());
  const [userAnswer, setUserAnswer] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);

    const numAnswer = parseInt(userAnswer);
    
    if (numAnswer === mathQuestion.answer) {
      toast.success("Correct! Welcome to f(x)");
      setTimeout(() => {
        onVerified();
      }, 500);
    } else {
      toast.error("Not quite! Try again");
      setMathQuestion(generateQuestion());
      setUserAnswer("");
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Age verification (solve to enter):</p>
        <p className="text-lg font-medium">
          <span className="text-muted-foreground">If </span>
          <span className="math-function text-accent">{mathQuestion.question.split('If ')[1].split(', what')[0]}</span>
          <span className="text-muted-foreground">, what is </span>
          <span className="math-function text-accent">{mathQuestion.question.split('what is ')[1].split('?')[0]}</span>
          <span className="text-muted-foreground">?</span>
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="number"
          value={userAnswer}
          onChange={(e) => setUserAnswer(e.target.value)}
          placeholder="Your answer"
          className="flex-1"
          disabled={isVerifying}
        />
        <Button type="submit" disabled={isVerifying || !userAnswer}>
          Enter
        </Button>
      </form>
    </div>
  );
};
