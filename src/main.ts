import "jodit/es2015/jodit.min.css";
import "highlight.js/styles/github.css";
import "./styles/main.scss";
import iconsSprite from "./assets/icons.svg?raw";
import { mountApp } from "./ui/appShell";

const ensureIconSprite = () => {
  if (document.getElementById("app-icons")) return;
  document.body.insertAdjacentHTML("afterbegin", iconsSprite);
};

const root = document.getElementById("root");
if (root) {
  ensureIconSprite();
  mountApp(root);
}
