import { AnalyzeView } from "@/components/analyze/analyze-view";

// A static shell. Session state, the selected movement, and the public
// catalog are resolved in the browser; the backend authorizes every request.
export default function AnalyzePage() {
  return <AnalyzeView />;
}
