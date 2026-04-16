declare module 'puppeteer' {
  interface LaunchOptions {
    headless?: boolean | 'shell';
    args?: string[];
  }

  interface PDFOptions {
    format?: string;
    printBackground?: boolean;
    margin?: {
      top?: string;
      bottom?: string;
      left?: string;
      right?: string;
    };
  }

  interface Page {
    setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
    pdf(options?: PDFOptions): Promise<Uint8Array>;
    close(): Promise<void>;
  }

  interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  export function launch(options?: LaunchOptions): Promise<Browser>;
}
