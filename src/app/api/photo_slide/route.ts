export const dynamic = 'force-dynamic';

import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

// Define directory paths relative to the project root
// const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
// const BEFORE_DIR = path.join(UPLOAD_DIR_BASE, 'before');
// const DISPLAYING_DIR = path.join(UPLOAD_DIR_BASE, 'displaying');
// const DONE_DIR = path.join(UPLOAD_DIR_BASE, 'done');
const BEFORE_DIR = '/tmp/uploads/before';
const DISPLAYING_DIR = '/tmp/uploads/displaying';
const DONE_DIR = '/tmp/uploads/done';

async function findOldestJpg(dir: string): Promise<{ name: string; path: string; birthtimeMs: number } | null> {
  try {
    const files = await fs.readdir(dir);
    const jpgFiles = files.filter((file) => file.toLowerCase().endsWith('.jpg'));

    if (jpgFiles.length === 0) {
      return null;
    }

    const filesWithStats = await Promise.all(
      jpgFiles.map(async (file) => {
        const filePath = path.join(dir, file);
        try {
          const stats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            // Use birthtimeMs for creation time, fallback to mtimeMs if birthtime isn't available/reliable
            birthtimeMs: stats.birthtimeMs || stats.mtimeMs
          };
        } catch (statError) {
          console.error(`Error getting stats for file ${filePath}:`, statError);
          // Return an object with Infinity time to ensure it's not picked as oldest
          return { name: file, path: filePath, birthtimeMs: Number.POSITIVE_INFINITY };
        }
      })
    );

    // Filter out any files where stats failed
    const validFiles = filesWithStats.filter((f) => f.birthtimeMs !== Number.POSITIVE_INFINITY);

    if (validFiles.length === 0) {
      return null; // No valid files found after attempting stat
    }

    // Sort by birth time (oldest first)
    validFiles.sort((a, b) => a.birthtimeMs - b.birthtimeMs);

    return validFiles[0];
  } catch (err: any) {
    // Handle specific error like directory not found gracefully
    if (err.code === 'ENOENT') {
      console.warn(`Directory not found: ${dir}`);
      return null;
    }
    // Re-throw other errors
    throw err;
  }
}

export async function GET(request: Request) {
  try {
    // --- Step 1: Find the oldest image in 'before' ---
    const oldestBeforeFile = await findOldestJpg(BEFORE_DIR);

    if (oldestBeforeFile) {
      // --- Step 2a: Move current 'displaying' image (if any) to 'done' ---
      let currentDisplayingFiles: string[] = [];
      try {
        currentDisplayingFiles = await fs.readdir(DISPLAYING_DIR);
      } catch (readdirErr: any) {
        if (readdirErr.code !== 'ENOENT') {
          // Ignore if 'displaying' doesn't exist yet
          console.warn(`Could not read displaying directory: ${DISPLAYING_DIR}`, readdirErr);
        }
        // Proceed, assuming no file to move
      }

      if (currentDisplayingFiles.length > 0) {
        // Assume only one file should be in 'displaying'
        const currentDisplayingFileName = currentDisplayingFiles[0];
        const currentDisplayingPath = path.join(DISPLAYING_DIR, currentDisplayingFileName);
        const donePath = path.join(DONE_DIR, currentDisplayingFileName);

        try {
          // Ensure DONE_DIR exists before moving
          await fs.mkdir(DONE_DIR, { recursive: true });
          await fs.rename(currentDisplayingPath, donePath);
          console.log(`Moved ${currentDisplayingFileName} from displaying to done.`);
        } catch (moveDoneError) {
          console.error(`Error moving file ${currentDisplayingPath} to ${donePath}:`, moveDoneError);
          // Decide if this is critical. For now, we'll log and attempt to continue.
          // If moving the new file fails later, the old one might still be in 'displaying'.
        }
      } else {
        // Ensure DISPLAYING_DIR exists for the next step
        await fs.mkdir(DISPLAYING_DIR, { recursive: true });
      }

      // --- Step 2b: Move the oldest 'before' image to 'displaying' ---
      const newDisplayingPath = path.join(DISPLAYING_DIR, oldestBeforeFile.name);
      try {
        await fs.rename(oldestBeforeFile.path, newDisplayingPath);
        console.log(`Moved ${oldestBeforeFile.name} from before to displaying.`);

        // --- Step 2c: Read and return the new 'displaying' image ---
        const imageBuffer = await fs.readFile(newDisplayingPath);
        return new NextResponse(imageBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
          }
        });
      } catch (moveDisplayingError) {
        console.error(`CRITICAL: Error moving file ${oldestBeforeFile.path} to ${newDisplayingPath}:`, moveDisplayingError);
        // If moving the new file fails, we might have an inconsistent state.
        // Return an error. Consider attempting to move the 'done' file back if needed.
        return NextResponse.json({ message: 'Failed to move new image to displaying directory' }, { status: 500 });
      }
    } else {
      // --- Step 3: 'before' is empty, try to serve from 'displaying' ---
      console.log("No new images in 'before'. Checking 'displaying'.");
      let currentDisplayingFiles: string[] = [];
      try {
        currentDisplayingFiles = await fs.readdir(DISPLAYING_DIR);
      } catch (readdirErr: any) {
        if (readdirErr.code === 'ENOENT') {
          console.warn(`Directory not found: ${DISPLAYING_DIR}`);
          // If 'displaying' also doesn't exist, there's nothing to show
          return NextResponse.json({ message: 'No image available in before or displaying' }, { status: 404 });
        }
        // Rethrow other errors
        throw readdirErr;
      }

      if (currentDisplayingFiles.length > 0) {
        // Assume only one file
        const currentDisplayingFileName = currentDisplayingFiles[0];
        const currentDisplayingPath = path.join(DISPLAYING_DIR, currentDisplayingFileName);

        try {
          const imageBuffer = await fs.readFile(currentDisplayingPath);
          console.log(`Serving existing image from displaying: ${currentDisplayingFileName}`);
          // Return existing image without moving it
          return new NextResponse(imageBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0'
            }
          });
        } catch (readDisplayingError) {
          console.error(`Error reading file from displaying ${currentDisplayingPath}:`, readDisplayingError);
          return NextResponse.json({ message: 'Failed to read image from displaying directory' }, { status: 500 });
        }
      } else {
        // --- Step 4: Both 'before' and 'displaying' are empty ---
        console.log("'displaying' directory is also empty.");
        return NextResponse.json({ message: 'No image available to display' }, { status: 404 });
        // Alternatively, return 204 No Content, but 404 seems more descriptive here.
        // return new NextResponse(null, { status: 204 });
      }
    }
  } catch (error) {
    console.error('Error processing photo slide request:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// Optional: Add explicit handler for other methods if needed, otherwise they default to 405 Method Not Allowed
// export async function POST(request: Request) {
//   return NextResponse.json({ message: 'Method Not Allowed' }, { status: 405 });
// }
