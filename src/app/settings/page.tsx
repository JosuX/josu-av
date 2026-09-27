import type { Metadata } from "next";
import { ObsSettings } from "@/components/ObsSettings";

export const metadata: Metadata = { title: "Settings · AV Control" };

export default function SettingsPage() {
  return <ObsSettings />;
}
