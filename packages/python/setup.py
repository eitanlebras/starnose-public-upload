from setuptools import setup, find_packages

setup(
    name="starnose",
    version="0.1.1",
    packages=find_packages(),
    entry_points={
        "console_scripts": [
            "starnose=starnose.cli:main",
            "snose=starnose.cli:main",
        ],
    },
)
