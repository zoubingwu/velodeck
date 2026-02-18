import { memo } from "react";
import {
  availableThemes,
  type ThemeMode,
  useTheme,
} from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipTrigger } from "@/components/ui/tooltip";
import { capitalize } from "@/lib/utils";

interface SettingsModalProps {
  children: React.ReactNode;
}

function SettingsModal({ children }: SettingsModalProps) {
  const { baseTheme, mode, setBaseTheme, setMode } = useTheme();

  const handleBaseThemeChange = (newBaseTheme: string) => {
    setBaseTheme(newBaseTheme);
  };

  const handleModeChange = (newMode: ThemeMode) => {
    setMode(newMode);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
        </DialogHeader>

        <fieldset className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="theme-mode" className="text-right col-span-1">
            Mode
          </Label>
          <RadioGroup
            value={mode}
            onValueChange={(value) => handleModeChange(value as ThemeMode)}
            className="col-span-3 flex space-x-2"
            id="theme-mode"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="light" id="r-light" />
              <Label htmlFor="r-light">Light</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="dark" id="r-dark" />
              <Label htmlFor="r-dark">Dark</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="system" id="r-system" />
              <Label htmlFor="r-system">System</Label>
            </div>
          </RadioGroup>
        </fieldset>

        <fieldset className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="base-theme" className="text-right">
            Theme
          </Label>
          <Select value={baseTheme} onValueChange={handleBaseThemeChange}>
            <SelectTrigger
              className="col-span-3 shadow-none font-medium"
              id="base-theme"
            >
              <SelectValue placeholder="Select a theme" />
            </SelectTrigger>
            <SelectContent>
              {availableThemes.map((themeName) => (
                <SelectItem key={themeName} value={themeName}>
                  {themeName.split("-").map(capitalize).join(" ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </fieldset>

        <DialogFooter className="mt-4 pt-4">
          <DialogClose asChild>
            <Button type="button" variant="default">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(SettingsModal);
