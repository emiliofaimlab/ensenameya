import { cn } from "@/lib/utils";

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // 1280 con gutter de 64 = 1152 de contenido, la rejilla del Figma.
      className={cn("mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-16", className)}
      {...props}
    />
  );
}
