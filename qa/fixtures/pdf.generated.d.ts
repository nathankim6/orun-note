// Type-only fallback for production CI's repository-wide tsc. QA builds generate
// pdf.generated.ts before bundling; production never imports the QA entry.
export declare const PDF_BASE64: string;
