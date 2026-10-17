"use client";

import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { JoinForm } from "../JoinForm";

export default function JoinWithCode() {
  const { code } = useParams<{ code: string }>();
  return (
    <Shell>
      <JoinForm initialCode={code} />
    </Shell>
  );
}
