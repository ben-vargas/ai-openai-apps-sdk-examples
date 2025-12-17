import React from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Image } from "@openai/apps-sdk-ui/components/Image";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";

function AlbumCard({ album, onSelect }) {
  return (
    <Button
      type="button"
      variant="ghost"
      color="secondary"
      pill={false}
      className="group relative flex-shrink-0 w-[272px] bg-white text-left p-0 h-auto min-h-0 rounded-none shadow-none gap-0 before:hidden"
      onClick={() => onSelect?.(album)}
    >
      <div className="flex w-full flex-col">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg">
          <Image
            src={album.cover}
            alt={album.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <Badge
            variant="soft"
            color="secondary"
            size="sm"
            pill
            className="absolute left-3 top-3 h-6 bg-white/90 px-2.5 text-xs font-medium text-black/70 shadow-none backdrop-blur"
          >
            Featured
          </Badge>
        </div>
        <div className="pt-3 px-1.5">
          <div className="text-base font-medium truncate">{album.title}</div>
          <Badge
            variant="soft"
            color="secondary"
            size="sm"
            pill={false}
            className="mt-0.5 h-auto bg-transparent px-0 py-0 text-sm font-normal text-black/60"
          >
            {album.photos.length} photos
          </Badge>
        </div>
      </div>
    </Button>
  );
}

export default AlbumCard;
