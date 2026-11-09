import "react-native-url-polyfill/auto";
import { registerRootComponent } from "expo";
import { reportError } from "./src/lib/report-error";
// Defines the background location task at module scope (required by
// expo-task-manager, including when the OS relaunches the app headless).
import "./src/native/session";
import App from "./App";

// Route uncaught JS errors through reportError before React Native's default handler.
const g = globalThis as {
  ErrorUtils?: {
    getGlobalHandler(): (e: unknown, fatal?: boolean) => void;
    setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void;
  };
};
if (g.ErrorUtils) {
  const previous = g.ErrorUtils.getGlobalHandler();
  g.ErrorUtils.setGlobalHandler((error, fatal) => {
    reportError(error, fatal ? "fatal" : "uncaught");
    previous(error, fatal);
  });
}

registerRootComponent(App);
