#!/usr/bin/env python3
# aider_wrapper.py

import argparse
import json
import sys

def main():
    parser = argparse.ArgumentParser(description="Placeholder for aider interaction.")
    parser.add_argument("--prompt", required=True, help="The prompt to send to the placeholder.")
    parser.add_argument(
        "--context-file",
        action="append",  # Allows the argument to appear multiple times
        help="Path to a context file to include",
        default=[]  # Initialize with an empty list if none are provided
    )

    try:
        args = parser.parse_args()
        prompt_value = args.prompt

        if prompt_value == 'trigger error':
            sys.stderr.write("Simulated error triggered by prompt.\n")
            sys.exit(1)

        response = {
            "overall_status": "success",
            "error": None,
            "events": [
                {
                    "type": "text_response",
                    "content": f"Placeholder response for prompt: {prompt_value}"
                }
            ],
            "received_context_files": args.context_file
        }

        # Print the JSON response to stdout
        json.dump(response, sys.stdout, indent=2)
        print() # Add a newline for cleaner output

    except SystemExit as e:
        # Argparse exits with status 2 for missing required arguments
        # We don't need to print the default argparse error message again
        # Just ensure we exit with a non-zero code
        if e.code != 0:
            sys.stderr.write("Error: --prompt argument is required.\n")
        sys.exit(e.code if e.code is not None else 1) # Exit with argparse code or 1
    except Exception as e:
        # Catch other potential errors
        sys.stderr.write(f"An unexpected error occurred: {e}\n")
        # Print a JSON error structure to stdout (optional, depends on desired error handling)
        error_response = {
            "overall_status": "error",
            "error": str(e),
            "events": []
        }
        json.dump(error_response, sys.stdout, indent=2)
        print()
        sys.exit(1)

if __name__ == "__main__":
    main() 