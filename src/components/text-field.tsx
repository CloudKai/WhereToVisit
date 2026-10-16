"use client";
import { useEffect, useId, useRef } from "react";
import {
  normalizedText,
  type TextPolicy,
  textError,
} from "@/shared/text-policy";

export function TextField({
  policy,
  value,
  onChange,
  id,
  autoComplete,
}: {
  policy: TextPolicy;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoComplete?: string;
}) {
  const generatedId = useId();
  const descriptionId = `${generatedId}-description`;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const error = textError(value, policy);
  useEffect(() => {
    ref.current?.setCustomValidity(error);
  }, [error]);
  const props = {
    id,
    ref,
    value,
    required: policy.required,
    autoComplete,
    "aria-describedby": descriptionId,
    "aria-invalid": !!error && value !== "",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      event.currentTarget.setCustomValidity(
        textError(event.target.value, policy),
      );
      onChange(event.target.value);
    },
  };
  return (
    <>
      {policy.multiline ? <textarea {...props} /> : <input {...props} />}
      <small id={descriptionId}>
        {Array.from(normalizedText(value, policy)).length}/{policy.limit}{" "}
        Unicode characters after trimming spaces.
        {policy.multiline && " Ordinary line breaks are allowed."}
        {error && value !== "" && <span role="alert"> {error}</span>}
      </small>
    </>
  );
}
