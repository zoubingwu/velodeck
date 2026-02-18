import { useMemoizedFn } from "ahooks";
import { useEffect, useState } from "react";
import type { services } from "@/bridge";
import { Disconnect, EventsOn } from "@/bridge";
import MainDataView from "@/components/MainDataView";
import WelcomeScreen from "@/components/WelcomeScreen";

type ViewState = "welcome" | "main";

function App() {
  const [currentView, setCurrentView] = useState<ViewState>("welcome");
  const [connectionDetails, setConnectionDetails] =
    useState<services.ConnectionDetails | null>(null);

  const navigateToMain = useMemoizedFn(
    (details: services.ConnectionDetails) => {
      setConnectionDetails(details);
      setCurrentView("main");
    },
  );

  const handleDisconnect = useMemoizedFn(() => {
    setConnectionDetails(null);
    setCurrentView("welcome");
  });

  useEffect(() => {
    const cleanupDisconnected = EventsOn("connection:disconnected", () => {
      handleDisconnect();
    });

    return () => {
      cleanupDisconnected();
    };
  }, [handleDisconnect]);

  const triggerDisconnect = useMemoizedFn(() => {
    void Disconnect();
  });

  const renderView = () => {
    switch (currentView) {
      case "welcome":
        return <WelcomeScreen onConnected={navigateToMain} />;
      case "main":
        return (
          <MainDataView
            onClose={triggerDisconnect}
            connectionDetails={connectionDetails}
          />
        );
      default:
        return <div>Unknown View</div>;
    }
  };

  return (
    <div id="App" className="h-screen w-screen flex flex-col">
      <div className="flex-grow overflow-auto">{renderView()}</div>
    </div>
  );
}

export default App;
