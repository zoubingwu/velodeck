import {
  GetAIProviderSettings,
  SaveAIProviderSettings,
} from "@/bridge";
import {
  type ThemeMode,
  availableThemes,
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
import { Input } from "@/components/ui/input";
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
import { AVAILABLE_MODELS, testProviderConnection } from "@/lib/ai";
import { capitalize } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Loader } from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";
import { useImmer } from "use-immer";
import type { services } from "@/bridge";

// Local types mirroring the *data structure* of Go types, excluding methods
type LocalOpenAISettings = Pick<
  services.OpenAISettings,
  "apiKey" | "baseURL" | "model"
>;
type LocalAnthropicSettings = Pick<
  services.AnthropicSettings,
  "apiKey" | "baseURL" | "model"
>;
type LocalOpenRouterSettings = Pick<
  services.OpenRouterSettings,
  "apiKey" | "model"
>;

interface LocalAIProviderSettings {
  provider: AIProvider;
  openai?: LocalOpenAISettings;
  anthropic?: LocalAnthropicSettings;
  openrouter?: LocalOpenRouterSettings;
}

// Define available providers
const aiProviders = ["openai", "openrouter"] as const;
type AIProvider = (typeof aiProviders)[number];

interface SettingsModalProps {
  children: React.ReactNode; // To wrap the trigger button
}

function SettingsModal({ children }: SettingsModalProps) {
  const { baseTheme, mode, setBaseTheme, setMode } = useTheme();
  const [aiSettings, setAiSettings] = useImmer<LocalAIProviderSettings>({
    provider: "openai",
    openai: { apiKey: "", baseURL: "", model: "" },
    anthropic: { apiKey: "", baseURL: "", model: "" },
    openrouter: { apiKey: "", model: "" },
  });

  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const { isLoading: isLoadingAISettings, refetch: refetchAISettings } =
    useQuery({
      queryKey: ["aiSettings"],
      queryFn: async () => {
        const settingsFromBackend = await GetAIProviderSettings();

        // copy the settings from the backend to the local state
        setAiSettings({
          provider: settingsFromBackend.provider as AIProvider,
          openai: { ...settingsFromBackend.openai },
          anthropic: { ...settingsFromBackend.anthropic },
          openrouter: { ...settingsFromBackend.openrouter },
        });

        return settingsFromBackend;
      },
    });

  const handleBaseThemeChange = (newBaseTheme: string) => {
    setBaseTheme(newBaseTheme);
  };

  const handleModeChange = (newMode: ThemeMode) => {
    setMode(newMode);
  };

  const handleAISettingChange = <K extends keyof LocalAIProviderSettings>(
    provider: K,
    field: keyof NonNullable<LocalAIProviderSettings[K]>,
    value: string,
  ) => {
    setAiSettings((draft) => {
      // @ts-ignore
      draft[provider][field] = value;
    });
  };

  const handleProviderSelectionChange = (newProvider: AIProvider) => {
    setAiSettings((draft) => {
      draft.provider = newProvider;
    });
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    const result = await testProviderConnection({
      provider: aiSettings.provider,
      apiKey: aiSettings[aiSettings.provider]?.apiKey,
      model: aiSettings[aiSettings.provider]?.model,
    });
    setIsTestingConnection(false);
    if (result.success) {
      toast.success("Connection succeeded", { description: result.message });
    } else {
      toast.error("Connection failed", { description: result.error });
    }
  };

  const handleSaveSettings = async () => {
    const updatedSettings = {
      ...aiSettings,
      provider: aiSettings.provider,
    };

    try {
      await SaveAIProviderSettings(
        updatedSettings as services.AIProviderSettings,
      );
      toast.success("Settings saved");
    } catch (error: any) {
      toast.error("Failed to save settings", { description: error.message });
    }
  };

  const renderAIProviderFields = () => {
    if (isLoadingAISettings || !aiSettings) {
      return <p>Loading AI settings...</p>; // Or a spinner
    }

    switch (aiSettings.provider) {
      case "openai":
        return (
          <>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="openai-apikey" className="text-right">
                API Key
              </Label>
              <Input
                id="openai-apikey"
                type="password"
                value={aiSettings.openai?.apiKey ?? ""}
                onChange={(e) =>
                  handleAISettingChange("openai", "apiKey", e.target.value)
                }
                className="col-span-3"
                placeholder="sk-..."
              />
            </div>
            {/* <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="openai-baseurl" className="text-right">
                Base URL
              </Label>
              <Input
                id="openai-baseurl"
                value={aiSettings.openai?.baseURL ?? ""}
                onChange={(e) =>
                  handleAISettingChange("openai", "baseURL", e.target.value)
                }
                className="col-span-3"
                placeholder="Optional, default: https://api.openai.com/v1"
              />
            </div> */}
          </>
        );
      // case "anthropic":
      //   return (
      //     <>
      //       <div className="grid grid-cols-4 items-center gap-4">
      //         <Label htmlFor="anthropic-apikey" className="text-right">
      //           API Key
      //         </Label>
      //         <Input
      //           id="anthropic-apikey"
      //           type="password"
      //           value={aiSettings.anthropic?.apiKey ?? ""}
      //           onChange={(e) =>
      //             handleAISettingChange("anthropic", "apiKey", e.target.value)
      //           }
      //           className="col-span-3"
      //           placeholder="sk-ant-..."
      //         />
      //       </div>
      //       <div className="grid grid-cols-4 items-center gap-4">
      //         <Label htmlFor="anthropic-baseurl" className="text-right">
      //           Base URL
      //         </Label>
      //         <Input
      //           id="anthropic-baseurl"
      //           value={aiSettings.anthropic?.baseURL ?? ""}
      //           onChange={(e) =>
      //             handleAISettingChange("anthropic", "baseURL", e.target.value)
      //           }
      //           className="col-span-3"
      //           placeholder="Optional, default: https://api.anthropic.com/v1"
      //         />
      //       </div>
      //     </>
      //   );
      case "openrouter":
        return (
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="openrouter-apikey" className="text-right">
              API Key
            </Label>
            <Input
              id="openrouter-apikey"
              type="password"
              value={aiSettings.openrouter?.apiKey ?? ""}
              onChange={(e) =>
                handleAISettingChange("openrouter", "apiKey", e.target.value)
              }
              className="col-span-3"
              placeholder="sk-or-..."
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          refetchAISettings();
        }
      }}
    >
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
              className="col-span-3  shadow-none font-medium"
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

        <fieldset className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="ai-provider" className="text-right col-span-1">
            Provider
          </Label>
          <RadioGroup
            value={aiSettings.provider}
            onValueChange={(value) =>
              handleProviderSelectionChange(value as AIProvider)
            }
            className="col-span-3 flex space-x-2"
            id="ai-provider"
          >
            {aiProviders.map((provider) => (
              <div key={provider} className="flex items-center space-x-2">
                <RadioGroupItem value={provider} id={`r-${provider}`} />
                <Label htmlFor={`r-${provider}`}>{capitalize(provider)}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>

        {renderAIProviderFields()}

        {aiSettings.provider && (
          <fieldset className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ai-model" className="text-right">
              Model
            </Label>
            <Select
              value={aiSettings[aiSettings.provider]?.model ?? ""}
              onValueChange={(value) => {
                if (aiSettings.provider) {
                  handleAISettingChange(aiSettings.provider, "model", value);
                }
              }}
              disabled={!aiSettings.provider || isLoadingAISettings}
            >
              <SelectTrigger
                className="col-span-3 shadow-none font-medium"
                id="ai-model"
              >
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {isLoadingAISettings ? (
                  <SelectItem value="loading" disabled>
                    Loading...
                  </SelectItem>
                ) : aiSettings.provider &&
                  AVAILABLE_MODELS[aiSettings.provider] &&
                  AVAILABLE_MODELS[aiSettings.provider]!.length > 0 ? (
                  AVAILABLE_MODELS[aiSettings.provider]!.map(
                    (modelName: string) => (
                      <SelectItem key={modelName} value={modelName}>
                        {modelName}
                      </SelectItem>
                    ),
                  )
                ) : (
                  <SelectItem value="no-models" disabled>
                    {aiSettings.provider
                      ? "No models available"
                      : "Select a provider first"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </fieldset>
        )}

        <DialogFooter className="mt-4 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={
              isTestingConnection ||
              !aiSettings.provider ||
              !aiSettings[aiSettings.provider]?.apiKey
            }
          >
            {isTestingConnection ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
          <DialogClose asChild>
            <Button
              type="button"
              variant="default"
              onClick={handleSaveSettings}
            >
              Save
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(SettingsModal);
