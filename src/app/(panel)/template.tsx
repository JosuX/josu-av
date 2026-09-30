"use client";

import { motion } from "motion/react";
import { EASE } from "@/components/motion";

// A template (unlike a layout) remounts on every navigation, so each page fades in.
export default function PanelTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      {children}
    </motion.div>
  );
}
