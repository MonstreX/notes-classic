import "jodit/es2015/jodit.min.css";
import "highlight.js/styles/github.css";
import "./styles/main.scss";
import { mountApp } from "./vanilla/appShell";

const root = document.getElementById("root");
if (root) {
  mountApp(root);
}
