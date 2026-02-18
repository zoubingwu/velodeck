import { GetThemeSettings, SaveThemeSettings } from "@/bridge";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

// Define the available theme names. These should match CSS classes.
// These are the *base* themes you switch between.
export const availableThemes = [
  "solar-dusk",
  "claude",
  "nature",
  "elegant-luxury",
  "neo-brutalism",
  "quantum-rose",
  "sunset-horizon",
  "twitter",
  "bubblegum",
  "retro-arcade",
];

// Map theme names to their primary font families
const fontsByTheme = {
  "elegant-luxury": ["Poppins", "Libre Baskerville", "IBM Plex Mono"],
  nature: ["Montserrat", "Merriweather", "Source Code Pro"],
  "neo-brutalism": ["DM Sans", "Space Mono"],
  "quantum-rose": ["Poppins", "Playfair Display", "Space Mono"],
  "solar-dusk": ["Oxanium", "Merriweather", "Fira Code"],
  twitter: ["Open Sans"],
  "retro-arcade": ["Outfit", "Space Mono"],
};

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  baseTheme: string;
  mode: ThemeMode;
  setBaseTheme: (theme: string) => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const downloadFont = (fonts?: string[]) => {
  if (!fonts || fonts.length === 0) return;

  const fontUrls = fonts.map((font) => {
    return {
      url: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=swap`,
      name: font,
    };
  });

  fontUrls.forEach(({ url, name }) => {
    const id = `font-${name}`;
    if (url && !document.getElementById(id)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.id = id;
      document.head.appendChild(link);
    }
  });
};

// Helper to apply theme classes to the root element
export const applyTheme = (base: string, mode: ThemeMode) => {
  console.log(`Applying base theme: ${base}, mode: ${mode}`);
  const root = document.documentElement;

  // Remove old base theme class
  root.classList.forEach((cls) => {
    if (availableThemes.includes(cls)) {
      root.classList.remove(cls);
    }
  });

  // Add new base theme class
  if (base && availableThemes.includes(base)) {
    root.classList.add(base);
    downloadFont(fontsByTheme[base as keyof typeof fontsByTheme]);
  }

  // Handle dark/light mode
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (mode === "dark" || (mode === "system" && prefersDark)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [baseTheme, setBaseThemeState] = useState<string>(availableThemes[0]);
  const [mode, setModeState] = useState<ThemeMode>("system");

  // Query to fetch initial settings from backend
  const { data: savedSettings } = useQuery({
    queryKey: ["themeSettings"],
    queryFn: GetThemeSettings,
    refetchOnWindowFocus: false,
  });

  // Apply saved settings on initial load
  useEffect(() => {
    if (savedSettings) {
      const initialBase = savedSettings.baseTheme || availableThemes[0];
      const initialMode = (savedSettings.mode as ThemeMode) || "system";
      setBaseThemeState(initialBase);
      setModeState(initialMode);
      // Initial apply is handled by the effect below
    }
  }, [savedSettings]);

  // Apply theme whenever baseTheme or mode changes
  useEffect(() => {
    applyTheme(baseTheme, mode);
  }, [baseTheme, mode]);

  // Listen for system theme changes when mode is 'system'
  useEffect(() => {
    if (mode !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyTheme(baseTheme, "system"); // Re-apply with 'system' to check preference
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mode, baseTheme]);

  // Persist theme changes to backend
  const persistTheme = async (newBase: string, newMode: ThemeMode) => {
    try {
      // Assuming a SaveThemeSettings function exists in your Go backend
      await SaveThemeSettings({ baseTheme: newBase, mode: newMode });
      console.log("Theme settings saved:", {
        baseTheme: newBase,
        mode: newMode,
      });
    } catch (error) {
      console.error("Failed to save theme settings:", error);
    }
  };

  const setBaseTheme = (theme: string) => {
    if (availableThemes.includes(theme)) {
      setBaseThemeState(theme);
      persistTheme(theme, mode);
    } else {
      console.warn(`Attempted to set invalid base theme: ${theme}`);
    }
  };

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    persistTheme(baseTheme, newMode);
  };

  return (
    <ThemeContext.Provider value={{ baseTheme, mode, setBaseTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Custom hook to use the theme context
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
