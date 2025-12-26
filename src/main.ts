import "./index.css";
import { mountApp } from "./vanilla/appShell";

const root = document.getElementById("root");
if (root) {
  mountApp(root);
}
