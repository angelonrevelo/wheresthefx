import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { login, register } from "@/api/client";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";

const emailSchema = z.string().email("Invalid email address").max(255, "Email must be less than 255 characters");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters").max(100, "Password must be less than 100 characters");

const Auth = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  
  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  
  // Signup state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupDisplayName, setSignupDisplayName] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Validate inputs
      emailSchema.parse(loginEmail.trim());
      passwordSchema.parse(loginPassword);

      await login(loginEmail.trim(), loginPassword);
      toast.success("Welcome back to f(x)!");
      navigate("/");
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        const msg = error.message;
        if (msg.includes("Invalid") || msg.includes("credentials")) {
          toast.error("Invalid email or password");
        } else {
          toast.error(msg);
        }
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Validate inputs
      emailSchema.parse(signupEmail.trim());
      passwordSchema.parse(signupPassword);

      if (!signupUsername.trim()) {
        toast.error("Username is required");
        setIsLoading(false);
        return;
      }

      await register(signupEmail.trim(), signupUsername.trim(), signupPassword);
      toast.success("Account created! Welcome to f(x)");
      navigate("/");
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        const msg = error.message;
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          toast.error("This email is already registered. Try logging in instead.");
        } else {
          toast.error(msg);
        }
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-accent/10 pointer-events-none" aria-hidden="true" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-accent/5 via-transparent to-transparent pointer-events-none" aria-hidden="true" />

      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-6 left-6 z-50"
        onClick={() => navigate("/", { replace: true })}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      {/* Auth card */}
      <div className="w-full max-w-md relative z-10">
        <div className="glass-card p-8 space-y-6">
          {/* Header */}
          <div className="space-y-2 text-center">
            <h1 className="text-4xl font-light tracking-tight">
              <span className="math-function text-accent">f</span>
              <span className="math-function text-accent">(x)</span>
            </h1>
            <p className="text-muted-foreground">Sign in to discover events in QC</p>
          </div>

          {/* Auth tabs */}
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            {/* Login tab */}
            <TabsContent value="login" className="space-y-4">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="your@email.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            {/* Signup tab */}
            <TabsContent value="signup" className="space-y-4">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-username">Username</Label>
                  <Input
                    id="signup-username"
                    type="text"
                    placeholder="username"
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-display-name">Display Name (optional)</Label>
                  <Input
                    id="signup-display-name"
                    type="text"
                    placeholder="Your Name"
                    value={signupDisplayName}
                    onChange={(e) => setSignupDisplayName(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="your@email.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum 6 characters
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Creating account..." : "Create Account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="text-center text-xs text-muted-foreground">
            By continuing, you agree to our terms of service
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
