"""dw-capture entrypoint. Live capture lands at S15 (Windows + Npcap).

Nothing here may leak below the Observation seam: the pipeline is built and
tested against fixtures, and capture is just one future producer.
"""


def main() -> None:
    raise SystemExit("dw-capture is not implemented until S15 (requires Windows + Npcap).")


if __name__ == "__main__":
    main()
