import type { ConnectionDetails } from "@shared/contracts";
import { useMemoizedFn } from "ahooks";
import { useEffect, useState } from "react";
import { api, onEvent } from "@/bridge";
import MainDataView from "@/components/MainDataView";
import WelcomeScreen from "@/components/WelcomeScreen";

type ViewState = "welcome" | "main";

function App() {
  const [currentView, setCurrentView] = useState<ViewState>("welcome");
  const [connectionDetails, setConnectionDetails] =
    useState<ConnectionDetails | null>(null);

  const navigateToMain = useMemoizedFn((details: ConnectionDetails) => {
    setConnectionDetails(details);
    setCurrentView("main");
  });

  const handleDisconnect = useMemoizedFn(() => {
    setConnectionDetails(null);
    setCurrentView("welcome");
  });

  useEffect(() => {
    const cleanupDisconnected = onEvent("connection:disconnected", () => {
      handleDisconnect();
    });

    return () => {
      cleanupDisconnected();
    };
  }, [handleDisconnect]);

  const triggerDisconnect = useMemoizedFn(() => {
    void api.connection.disconnect();
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
