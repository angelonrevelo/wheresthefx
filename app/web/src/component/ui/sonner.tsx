import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-left"
      offset="var(--card-margin)"
      style={{ "--width": "288px" } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast:
            "group toast glass-card group-[.toaster]:border-[var(--glass-border)] group-[.toaster]:text-foreground group-[.toaster]:shadow-[var(--glass-shadow)] group-[.toaster]:text-xs group-[.toaster]:py-2 group-[.toaster]:px-3 group-[.toaster]:min-h-0 group-[.toaster]:rounded-[var(--card-radius)]",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-[11px]",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:text-[11px]",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:text-[11px]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
