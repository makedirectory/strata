import type { ComponentType } from "react";
import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../../../mdx-components";

export const generateStaticParams = generateStaticParamsFor("mdxPath");

interface PageProps {
  params: Promise<{ mdxPath?: string[] }>;
}

export async function generateMetadata(props: PageProps) {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  return metadata;
}

// Nextra's MDX wrapper is loosely typed; render it as a generic component.
const Wrapper = getMDXComponents().wrapper as ComponentType<{
  toc: unknown;
  metadata: unknown;
  sourceCode?: unknown;
  children: React.ReactNode;
}>;

export default async function Page(props: PageProps) {
  const params = await props.params;
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(params.mdxPath);
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}
