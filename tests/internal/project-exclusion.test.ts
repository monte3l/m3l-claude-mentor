import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  canonicalProject,
  isProjectExcluded,
  normalizeProjectPath,
  type ProjectPathOptions,
} from "../../src/internal/project-exclusion.ts";

/** A fake realpath: maps known paths, throws ENOENT for the rest. */
function fakeRealpath(map: Readonly<Record<string, string>>) {
  return vi.fn((p: string): string => {
    const hit = map[p];
    if (hit === undefined) {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    }
    return hit;
  });
}

const linux = { platform: "linux" } as const;

describe("canonicalProject", () => {
  test("returns the real path from realpath", () => {
    const realpath = fakeRealpath({ "/link/p": "/real/p" });
    expect(canonicalProject("/link/p", { realpath })).toBe("/real/p");
    expect(realpath).toHaveBeenCalledWith("/link/p");
  });

  test("removes a trailing separator from the real path", () => {
    const realpath = fakeRealpath({ "/link/p": "/real/p/" });
    expect(canonicalProject("/link/p", { realpath })).toBe("/real/p");
  });

  test("keeps the root intact", () => {
    const realpath = fakeRealpath({ "/": "/" });
    expect(canonicalProject("/", { realpath })).toBe("/");
  });

  test("falls back to the normalised path when realpath throws", () => {
    const realpath = fakeRealpath({});
    expect(canonicalProject("/a/b/../c/", { realpath })).toBe("/a/c");
  });

  test.each([
    ["rel/p", "rel/p"],
    ["./rel//p/", "rel/p"],
  ])(
    "a relative path %j is normalised lexically and never resolved",
    (input, expected) => {
      const realpath = vi.fn((p: string): string => `/resolved/${p}`);
      expect(canonicalProject(input, { realpath })).toBe(expected);
      expect(realpath).not.toHaveBeenCalled();
    },
  );

  test("never throws, even for a non-Error rejection", () => {
    const realpath = vi.fn((): string => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentional non-Error to verify the fallback never throws
      throw "boom";
    });
    expect(canonicalProject("/a/b/", { realpath })).toBe("/a/b");
  });

  test("does not case-fold the stored value", () => {
    const realpath = fakeRealpath({ "/x": "/Real/Path" });
    expect(canonicalProject("/x", { realpath })).toBe("/Real/Path");
    expect(canonicalProject("/Not/There", { realpath })).toBe("/Not/There");
  });
});

describe("canonicalProject options type", () => {
  test("accepts only a realpath option", () => {
    expectTypeOf(canonicalProject)
      .parameter(1)
      .toEqualTypeOf<Pick<ProjectPathOptions, "realpath"> | undefined>();
  });
});

describe("normalizeProjectPath", () => {
  test.each([
    ["the root", "/", "/"],
    ["a trailing slash", "/a/b/", "/a/b"],
    ["dot-dot segments", "/a/x/../b", "/a/b"],
    ["a trailing slash after collapsing", "/a/x/../b/", "/a/b"],
    ["an already-normal path", "/a/b", "/a/b"],
  ])("%s", (_n, input, expected) => {
    expect(normalizeProjectPath(input)).toBe(expected);
  });
});

describe("isProjectExcluded", () => {
  test("an empty list is false and never calls realpath", () => {
    const realpath = fakeRealpath({});
    expect(isProjectExcluded([], "/a/b", { ...linux, realpath })).toBe(false);
    expect(realpath).not.toHaveBeenCalled();
  });

  test.each([
    ["the project itself", "/a/b", "/a/b"],
    ["a trailing separator on the entry", "/a/b/", "/a/b"],
    ["a trailing separator on the cwd", "/a/b", "/a/b/"],
    ["a child", "/a/b", "/a/b/c"],
    ["a deep descendant", "/a", "/a/b/c/d"],
    ["a non-normalised cwd", "/a/b", "/a/x/../b/c"],
  ])("lexical match: %s", (_n, entry, cwd) => {
    expect(
      isProjectExcluded([entry], cwd, { ...linux, realpath: fakeRealpath({}) }),
    ).toBe(true);
  });

  test("a sibling sharing a name prefix is not excluded", () => {
    expect(
      isProjectExcluded(["/a/b"], "/a/bc", {
        ...linux,
        realpath: fakeRealpath({}),
      }),
    ).toBe(false);
  });

  test("a sibling sharing a prefix is not excluded after realpath", () => {
    const realpath = fakeRealpath({ "/l/bc": "/a/bc", "/l/b": "/a/b" });
    expect(isProjectExcluded(["/l/b"], "/l/bc", { ...linux, realpath })).toBe(
      false,
    );
    expect(isProjectExcluded(["/a/b"], "/l/bc", { ...linux, realpath })).toBe(
      false,
    );
  });

  test("an unrelated cwd is not excluded", () => {
    expect(
      isProjectExcluded(["/a/b"], "/z/y", {
        ...linux,
        realpath: fakeRealpath({ "/z/y": "/z/y", "/a/b": "/a/b" }),
      }),
    ).toBe(false);
  });

  test("cwd via a symlink, entry stored as the real path", () => {
    const realpath = fakeRealpath({ "/link": "/real/p", "/real/p": "/real/p" });
    expect(
      isProjectExcluded(["/real/p"], "/link", { ...linux, realpath }),
    ).toBe(true);
  });

  test("cwd is real, entry stored as the link path", () => {
    const realpath = fakeRealpath({ "/link": "/real/p", "/real/p": "/real/p" });
    expect(
      isProjectExcluded(["/link"], "/real/p", { ...linux, realpath }),
    ).toBe(true);
  });

  test("a subdirectory reached through a symlink", () => {
    const realpath = fakeRealpath({
      "/link/sub/deep": "/real/p/sub/deep",
      "/real/p": "/real/p",
    });
    expect(
      isProjectExcluded(["/real/p"], "/link/sub/deep", { ...linux, realpath }),
    ).toBe(true);
  });

  test("mixed: real cwd versus a lexical entry that no longer resolves", () => {
    const realpath = fakeRealpath({ "/link/sub": "/real/p/sub" });
    expect(
      isProjectExcluded(["/real/p"], "/link/sub", { ...linux, realpath }),
    ).toBe(true);
  });

  test("mixed: lexical cwd versus the real path of the entry", () => {
    const realpath = fakeRealpath({ "/link": "/real/p" });
    expect(
      isProjectExcluded(["/link"], "/real/p/sub", { ...linux, realpath }),
    ).toBe(true);
  });

  test("a realpath failure for the cwd falls back to the lexical form", () => {
    const realpath = fakeRealpath({ "/real/p": "/real/p" });
    expect(
      isProjectExcluded(["/real/p"], "/real/p/gone", { ...linux, realpath }),
    ).toBe(true);
    expect(
      isProjectExcluded(["/real/p"], "/other/gone", { ...linux, realpath }),
    ).toBe(false);
  });

  test("a realpath failure for an entry falls back to its lexical form", () => {
    const realpath = fakeRealpath({ "/link": "/real/p" });
    expect(
      isProjectExcluded(["/missing/p"], "/missing/p/x", { ...linux, realpath }),
    ).toBe(true);
  });

  test("any entry in the list can match", () => {
    expect(
      isProjectExcluded(["/x", "/y", "/a/b"], "/a/b/c", {
        ...linux,
        realpath: fakeRealpath({}),
      }),
    ).toBe(true);
  });

  test("a root entry excludes everything", () => {
    const realpath = fakeRealpath({ "/": "/" });
    expect(isProjectExcluded(["/"], "/any/where", { ...linux, realpath })).toBe(
      true,
    );
    expect(isProjectExcluded(["/"], "/", { ...linux, realpath })).toBe(true);
  });

  test.each(["darwin", "win32"] as const)(
    "is case-insensitive on %s",
    (platform) => {
      const realpath = fakeRealpath({});
      expect(
        isProjectExcluded(["/Users/Me/Proj"], "/users/me/PROJ/Sub", {
          platform,
          realpath,
        }),
      ).toBe(true);
      expect(
        isProjectExcluded(["/Users/Me/Proj"], "/users/me/projx", {
          platform,
          realpath,
        }),
      ).toBe(false);
    },
  );

  test("case-insensitive match also applies to realpath results on darwin", () => {
    const realpath = fakeRealpath({ "/link": "/Real/Proj" });
    expect(
      isProjectExcluded(["/real/proj"], "/link", {
        platform: "darwin",
        realpath,
      }),
    ).toBe(true);
  });

  test("is case-sensitive on linux", () => {
    expect(
      isProjectExcluded(["/Users/Me/Proj"], "/users/me/proj/sub", {
        ...linux,
        realpath: fakeRealpath({}),
      }),
    ).toBe(false);
  });
});

describe("isProjectExcluded nearest existing ancestor", () => {
  function failing(
    map: Readonly<Record<string, string>>,
    code: string,
  ): (p: string) => string {
    return vi.fn((p: string): string => {
      const hit = map[p];
      if (hit === undefined) {
        throw Object.assign(new Error(`${code}: ${p}`), { code });
      }
      return hit;
    });
  }

  test.each(["ENOENT", "EACCES", "ELOOP", "ENAMETOOLONG"])(
    "a %s cwd under a symlinked excluded project is still excluded",
    (code) => {
      const realpath = failing(
        { "/link": "/real/p", "/real/p": "/real/p" },
        code,
      );
      expect(
        isProjectExcluded(["/real/p"], "/link/build/x", { ...linux, realpath }),
      ).toBe(true);
    },
  );

  test("a deleted cwd under an unrelated real dir is not excluded", () => {
    const realpath = failing(
      { "/other": "/other", "/real/p": "/real/p" },
      "ENOENT",
    );
    expect(
      isProjectExcluded(["/real/p"], "/other/build/x", { ...linux, realpath }),
    ).toBe(false);
  });

  test("a deleted sibling-prefix cwd is not excluded", () => {
    const realpath = failing(
      { "/real": "/real", "/real/p": "/real/p" },
      "ENOENT",
    );
    expect(
      isProjectExcluded(["/real/p"], "/real/pq/x", { ...linux, realpath }),
    ).toBe(false);
  });

  test("when every ancestor fails it falls back to the lexical form", () => {
    const realpath = failing({}, "ENOENT");
    expect(isProjectExcluded(["/a/b"], "/a/b/c", { ...linux, realpath })).toBe(
      true,
    );
    expect(isProjectExcluded(["/z"], "/a/b/c", { ...linux, realpath })).toBe(
      false,
    );
  });

  test("an entry whose own realpath fails keeps matching lexically", () => {
    const realpath = failing({}, "EACCES");
    expect(
      isProjectExcluded(["/link/proj"], "/link/proj/x", { ...linux, realpath }),
    ).toBe(true);
  });

  test("a non-existent entry under a resolvable parent matches via parent-real plus tail", () => {
    const realpath = failing(
      { "/link": "/real/p", "/real/p": "/real/p" },
      "ENOENT",
    );
    expect(
      isProjectExcluded(["/link/gone"], "/real/p/gone/sub", {
        ...linux,
        realpath,
      }),
    ).toBe(true);
    expect(
      isProjectExcluded(["/link/gone"], "/real/p/other", {
        ...linux,
        realpath,
      }),
    ).toBe(false);
  });

  test("a relative entry is skipped, never resolved against the process cwd", () => {
    // This resolver models realpath resolving a relative path against the
    // process cwd (/work): a relative entry must still not match.
    const realpath = vi.fn((p: string): string =>
      p.startsWith("/") ? p : `/work/${p}`,
    );
    expect(
      isProjectExcluded(["proj", "."], "/work/proj/x", { ...linux, realpath }),
    ).toBe(false);
    expect(realpath).not.toHaveBeenCalledWith("proj");
    expect(realpath).not.toHaveBeenCalledWith(".");
  });
});

describe("with real symlinks (default realpath)", () => {
  let root = "";
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function setup(): { real: string; link: string } {
    root = realpathSync(mkdtempSync(join(tmpdir(), "excl-")));
    const real = join(root, "proj");
    const link = join(root, "link");
    mkdirSync(join(real, "sub"), { recursive: true });
    symlinkSync(real, link);
    return { real, link };
  }

  test("a cwd reached through a real symlink is excluded", () => {
    const { real, link } = setup();
    expect(isProjectExcluded([real], link)).toBe(true);
    expect(isProjectExcluded([real], join(link, "sub"))).toBe(true);
    expect(isProjectExcluded([join(root, "pro")], link)).toBe(false);
  });

  test("an entry stored as a link path excludes the real directory", () => {
    const { real, link } = setup();
    expect(isProjectExcluded([link], join(real, "sub"))).toBe(true);
    expect(canonicalProject(link)).toBe(real);
  });
});
